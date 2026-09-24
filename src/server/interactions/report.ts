import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { guilds, type Report, reports } from "../db/schema";
import { CATEGORIES, SEVERITIES } from "../discord/commands";
import {
  hasPermission,
  modalValues,
  optionValue,
  Permission,
  ResponseType,
} from "../discord/types";
import { env } from "../env";
import { enqueue, enqueueReportFollowUps } from "../jobs/enqueue";
import type { Ctx, HandlerResult } from "./handle";
import { alertMessage, effectiveSeverity, ephemeral, receiptMessage } from "./messages";

const severity = z.enum(SEVERITIES).catch("medium");
const category = z.enum(CATEGORIES).catch("other");

const draftSchema = z.object({
  title: z.string().trim().min(1).max(100),
  details: z.string().trim().min(1).max(1500),
  severity: z.enum(SEVERITIES),
  category: z.enum(CATEGORIES),
});

type Draft = z.infer<typeof draftSchema>;

function label(labelText: string, component: Record<string, unknown>, description?: string) {
  return { type: 18, label: labelText, description, component };
}

function select(customId: string, values: readonly string[], selected: string) {
  return {
    type: 3,
    custom_id: customId,
    required: true,
    options: values.map((v) => ({
      label: v[0].toUpperCase() + v.slice(1),
      value: v,
      default: v === selected,
    })),
  };
}

function reportModal(defaults: { severity: string; category: string }) {
  return {
    type: ResponseType.Modal,
    data: {
      custom_id: "report:modal",
      title: "Report a problem",
      components: [
        label("Title", {
          type: 4,
          custom_id: "title",
          style: 1,
          min_length: 3,
          max_length: 100,
          required: true,
          placeholder: "Short summary, e.g. Voice channels keep dropping",
        }),
        label("What happened?", {
          type: 4,
          custom_id: "details",
          style: 2,
          min_length: 10,
          max_length: 1500,
          required: true,
          placeholder: "Include what you saw, when it started and any links.",
        }),
        label("Severity", select("severity", SEVERITIES, defaults.severity)),
        label("Category", select("category", CATEGORIES, defaults.category)),
      ],
    },
  };
}

function aiAvailable(ctx: Ctx) {
  return ctx.rules.report.settings.aiTriage && Boolean(env().GROQ_API_KEY);
}

async function fileReport(ctx: Ctx, draft: Draft): Promise<HandlerResult> {
  const { tx, guild, interaction, actor } = ctx;

  // Per-server numbering. The row lock on the guild serialises concurrent reports so two
  // reports can never get the same number.
  const [{ next }] = await tx
    .update(guilds)
    .set({ reportCount: sql`${guilds.reportCount} + 1` })
    .where(eq(guilds.id, guild.id))
    .returning({ next: guilds.reportCount });

  const [report] = await tx
    .insert(reports)
    .values({
      guildId: guild.id,
      number: next,
      interactionId: interaction.id,
      channelId: interaction.channel_id ?? null,
      reporterId: actor.id,
      reporterName: actor.name,
      title: draft.title,
      details: draft.details,
      category: draft.category,
      severity: draft.severity,
      aiStatus: aiAvailable(ctx) ? "pending" : "skipped",
      createdAt: ctx.now,
    })
    .returning();

  if (report.aiStatus === "pending") {
    await enqueue(tx, {
      guildId: guild.id,
      interactionId: interaction.id,
      reportId: report.id,
      kind: "triage",
      payload: { kind: "triage" },
    });
  } else {
    await enqueueReportFollowUps(tx, guild, report);
  }

  return {
    result: "accepted",
    response: { type: ResponseType.ChannelMessage, data: receiptMessage(report) },
    needsToken: true,
  };
}

export async function handleReportCommand(ctx: Ctx): Promise<HandlerResult> {
  const i = ctx.interaction;
  const details = optionValue(i, "details");
  const sev = severity.parse(optionValue(i, "severity") ?? "medium");
  const cat = category.parse(optionValue(i, "category") ?? "other");

  if (typeof details !== "string" || details.trim() === "") {
    return {
      result: "accepted",
      response: reportModal({ severity: sev, category: cat }),
    };
  }

  const text = details.trim();
  const firstLine = text.split("\n")[0];
  return fileReport(ctx, {
    title: firstLine.length > 100 ? `${firstLine.slice(0, 99)}…` : firstLine,
    details: text,
    severity: sev,
    category: cat,
  });
}

export async function handleReportModal(ctx: Ctx): Promise<HandlerResult> {
  const values = modalValues(ctx.interaction);
  const parsed = draftSchema.safeParse({
    title: values.title,
    details: values.details,
    severity: values.severity ?? "medium",
    category: values.category ?? "other",
  });
  if (!parsed.success) {
    return {
      result: "invalid",
      response: ephemeral("That form came through incomplete. Please try /report again."),
    };
  }
  return fileReport(ctx, parsed.data);
}

const TRANSITIONS = {
  ack: { to: "acknowledged", verb: "acknowledged" },
  resolve: { to: "resolved", verb: "resolved" },
  reopen: { to: "open", verb: "reopened" },
} as const;

export async function handleReportButton(ctx: Ctx): Promise<HandlerResult> {
  const { tx, interaction, guild, actor } = ctx;
  const [, action, reportId] = (interaction.data?.custom_id ?? "").split(":");
  const transition = TRANSITIONS[action as keyof typeof TRANSITIONS];
  if (!transition || !z.uuid().safeParse(reportId).success) {
    return { result: "invalid", response: ephemeral("That button isn't valid anymore.") };
  }

  // Scoped by guild as well as id: a crafted custom_id can't reach another server's report.
  const current = await tx.query.reports.findFirst({
    where: and(eq(reports.id, reportId), eq(reports.guildId, guild.id)),
  });
  if (!current) {
    return { result: "invalid", response: ephemeral("I can't find that report on this server.") };
  }

  if (!hasPermission(interaction, Permission.ManageMessages)) {
    return {
      result: "forbidden",
      response: ephemeral("You need the Manage Messages permission to change a report's status."),
    };
  }

  // Conditional update: if two moderators click at once, only one transition wins and only
  // that one produces a mirror notification.
  const [updated] = await tx
    .update(reports)
    .set({ status: transition.to, statusChangedBy: actor.name, statusChangedAt: ctx.now })
    .where(and(eq(reports.id, current.id), ne(reports.status, transition.to)))
    .returning();

  const report: Report = updated ?? current;
  const sev = effectiveSeverity(report, ctx.rules.report.settings.severitySource);

  if (updated && guild.mirrorKind) {
    await enqueue(tx, {
      guildId: guild.id,
      interactionId: interaction.id,
      reportId: report.id,
      kind: "mirror",
      payload: { kind: "mirror", event: "status_change", actor: actor.name },
    });
  }

  // UPDATE_MESSAGE edits the alert in place as part of the interaction response, so no REST
  // call is needed. The role ping is dropped on edits.
  return {
    result: "accepted",
    response: { type: ResponseType.UpdateMessage, data: alertMessage(report, sev, null) },
  };
}
