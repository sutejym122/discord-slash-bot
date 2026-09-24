import "server-only";
import { eq } from "drizzle-orm";
import type { Tx } from "../db/client";
import { type Guild, type JobKind, jobs, type Report } from "../db/schema";
import { meetsSeverity, parseRule } from "../guilds/rules";
import { effectiveSeverity } from "../interactions/messages";
import { policyFor } from "./policy";

export type JobPayload =
  | { kind: "triage" }
  | { kind: "reply" }
  | { kind: "channel_post"; severity: string; pingRoleId: string | null }
  | { kind: "mirror"; event: "report"; severity: string }
  | { kind: "mirror"; event: "status_change"; actor: string }
  | { kind: "mirror"; event: "status_check"; actor: string };

export async function enqueue(
  tx: Tx,
  job: {
    guildId: string;
    interactionId: string;
    reportId?: string | null;
    kind: JobKind;
    payload: JobPayload;
    runAt?: Date;
  },
) {
  // Unique on (interaction_id, kind): enqueueing the same step twice is a no-op, which is
  // what makes re-running a half-finished triage safe.
  await tx
    .insert(jobs)
    .values({
      guildId: job.guildId,
      interactionId: job.interactionId,
      reportId: job.reportId ?? null,
      kind: job.kind,
      payload: job.payload,
      maxAttempts: policyFor(job.kind).maxAttempts,
      runAt: job.runAt ?? new Date(),
    })
    .onConflictDoNothing({ target: [jobs.interactionId, jobs.kind] });
}

// Runs once a report's severity is final: straight away when AI is off, otherwise when triage
// finishes or gives up. Reads the rules at that moment so a change in the dashboard applies to
// reports still in flight.
export async function enqueueReportFollowUps(tx: Tx, guild: Guild, report: Report) {
  const ruleRow = await tx.query.commandRules.findFirst({
    where: (r, { and }) => and(eq(r.guildId, guild.id), eq(r.command, "report")),
  });
  const { settings } = parseRule("report", ruleRow);
  const severity = effectiveSeverity(report, settings.severitySource);
  const base = { guildId: guild.id, interactionId: report.interactionId, reportId: report.id };

  await enqueue(tx, { ...base, kind: "reply", payload: { kind: "reply" } });

  if (guild.alertChannelId && meetsSeverity(severity, settings.alertMinSeverity)) {
    const ping = settings.pingRoleId && meetsSeverity(severity, settings.pingMinSeverity);
    await enqueue(tx, {
      ...base,
      kind: "channel_post",
      payload: { kind: "channel_post", severity, pingRoleId: ping ? settings.pingRoleId : null },
    });
  }

  if (guild.mirrorKind && meetsSeverity(severity, settings.mirrorMinSeverity)) {
    await enqueue(tx, {
      ...base,
      kind: "mirror",
      payload: { kind: "mirror", event: "report", severity },
    });
  }
}
