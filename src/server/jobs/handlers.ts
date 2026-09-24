import "server-only";
import { and, eq } from "drizzle-orm";
import { triageReport } from "../ai/triage";
import { decrypt } from "../crypto";
import { db, type Tx } from "../db/client";
import { type Guild, type Interaction, type Job, jobs, type Report, reports } from "../db/schema";
import { createChannelMessage, editOriginalResponse } from "../discord/rest";
import { alertMessage, mirrorText, replyMessage } from "../interactions/messages";
import { deliverMirror } from "../mirror";
import { enqueueReportFollowUps, type JobPayload } from "./enqueue";
import { permanent, retryable } from "./errors";

export type JobContext = {
  job: Job;
  guild: Guild;
  report: Report | null;
  interaction: Interaction;
  now: Date;
};

// A handler does the external work, then optionally returns a function that records the
// result in the same transaction that marks the job succeeded.
export type HandlerOutcome = { commit?: (tx: Tx) => Promise<void> };

function requireReport(ctx: JobContext): Report {
  if (!ctx.report) throw permanent("report_missing", "The report for this job no longer exists");
  return ctx.report;
}

async function triage(ctx: JobContext): Promise<HandlerOutcome> {
  const report = requireReport(ctx);
  const result = await triageReport(report);
  return {
    commit: async (tx) => {
      const [updated] = await tx
        .update(reports)
        .set({
          aiStatus: "done",
          aiSummary: result.summary,
          aiCategory: result.category,
          aiSeverity: result.severity,
          aiTags: result.tags,
          aiNextStep: result.next_step,
          aiError: null,
        })
        .where(eq(reports.id, report.id))
        .returning();
      await enqueueReportFollowUps(tx, ctx.guild, updated);
    },
  };
}

// Called when triage has failed for good: the report still goes out, just without AI fields.
export async function degradeTriage(tx: Tx, ctx: JobContext, reason: string) {
  const report = requireReport(ctx);
  const [updated] = await tx
    .update(reports)
    .set({ aiStatus: "failed", aiError: reason })
    .where(eq(reports.id, report.id))
    .returning();
  await enqueueReportFollowUps(tx, ctx.guild, updated);
}

async function reply(ctx: JobContext): Promise<HandlerOutcome> {
  const report = requireReport(ctx);
  const { interaction } = ctx;
  if (
    !interaction.tokenEncrypted ||
    !interaction.tokenExpiresAt ||
    interaction.tokenExpiresAt < ctx.now
  ) {
    throw permanent(
      "interaction_token_expired",
      "The 15 minute window to update the reply has passed",
    );
  }
  const posting = await db().query.jobs.findFirst({
    where: and(eq(jobs.interactionId, interaction.id), eq(jobs.kind, "channel_post")),
    columns: { id: true },
  });
  const routedTo = posting && ctx.guild.alertChannelName ? `#${ctx.guild.alertChannelName}` : null;
  await editOriginalResponse(decrypt(interaction.tokenEncrypted), replyMessage(report, routedTo));
  return {};
}

async function channelPost(ctx: JobContext): Promise<HandlerOutcome> {
  const report = requireReport(ctx);
  const payload = ctx.job.payload as Extract<JobPayload, { kind: "channel_post" }>;
  const channelId = ctx.guild.alertChannelId;
  if (!channelId) throw permanent("alert_channel_not_set", "No alert channel is configured");

  const message = await createChannelMessage(
    channelId,
    alertMessage(report, payload.severity as Report["severity"], payload.pingRoleId),
    ctx.job.id.replaceAll("-", "").slice(0, 25),
  );
  return {
    commit: async (tx) => {
      await tx
        .update(reports)
        .set({ alertChannelId: message.channel_id, alertMessageId: message.id })
        .where(eq(reports.id, report.id));
    },
  };
}

async function mirror(ctx: JobContext): Promise<HandlerOutcome> {
  const { guild, now } = ctx;
  if (!guild.mirrorKind || !guild.mirrorUrlEncrypted) {
    throw permanent("mirror_not_configured", "The mirror webhook was removed");
  }
  if (guild.mirrorOutageUntil && guild.mirrorOutageUntil > now) {
    throw retryable("mirror_simulated_outage", "Simulated outage (testing tool) returned 503", 503);
  }

  const payload = ctx.job.payload as Extract<JobPayload, { kind: "mirror" }>;
  const text =
    payload.event === "status_check"
      ? mirrorText(guild.name, { kind: "status_check", actor: payload.actor })
      : payload.event === "status_change"
        ? mirrorText(guild.name, {
            kind: "status_change",
            report: requireReport(ctx),
            actor: payload.actor,
          })
        : mirrorText(guild.name, {
            kind: "report",
            report: requireReport(ctx),
            severity: payload.severity as Report["severity"],
          });

  await deliverMirror(guild.mirrorKind, decrypt(guild.mirrorUrlEncrypted), text);
  return {};
}

// Handlers run outside any transaction so no connection is held open during network calls.
export async function runHandler(ctx: JobContext): Promise<HandlerOutcome> {
  switch (ctx.job.kind) {
    case "triage":
      return triage(ctx);
    case "reply":
      return reply(ctx);
    case "channel_post":
      return channelPost(ctx);
    case "mirror":
      return mirror(ctx);
  }
}
