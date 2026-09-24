import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import { type Guild, jobs, reports } from "../db/schema";
import { ResponseType } from "../discord/types";
import { env } from "../env";
import type { RuleSet } from "../guilds/rules";
import { enqueue } from "../jobs/enqueue";
import type { Ctx, HandlerResult } from "./handle";
import { type StatusSnapshot, statusMessage } from "./messages";

export async function statusSnapshot(
  tx: Tx,
  guild: Guild,
  rules: RuleSet,
  now: Date,
): Promise<StatusSnapshot> {
  // Raw sql fragments bypass drizzle's column mapping, so the timestamp goes in as ISO text.
  const since = new Date(now.getTime() - 24 * 3600_000).toISOString();

  const [counts] = await tx
    .select({
      open: sql<number>`count(*) filter (where ${reports.status} = 'open')::int`,
      acknowledged: sql<number>`count(*) filter (where ${reports.status} = 'acknowledged')::int`,
      last24h: sql<number>`count(*) filter (where ${reports.createdAt} >= ${since}::timestamptz)::int`,
    })
    .from(reports)
    .where(eq(reports.guildId, guild.id));

  const [jobCounts] = await tx
    .select({
      retrying: sql<number>`count(*) filter (where ${jobs.status} = 'retrying')::int`,
      failed: sql<number>`count(*) filter (where ${jobs.status} = 'failed' and ${jobs.updatedAt} >= ${since}::timestamptz)::int`,
    })
    .from(jobs)
    .where(eq(jobs.guildId, guild.id));

  const [lastFailure] = await tx
    .select({ kind: jobs.kind, error: jobs.lastError })
    .from(jobs)
    .where(
      and(
        eq(jobs.guildId, guild.id),
        eq(jobs.status, "failed"),
        gte(jobs.updatedAt, new Date(since)),
      ),
    )
    .orderBy(desc(jobs.updatedAt))
    .limit(1);

  return {
    guildName: guild.name,
    alertChannelName: guild.alertChannelName,
    mirrorKind: guild.mirrorKind,
    aiEnabled: rules.report.settings.aiTriage && Boolean(env().GROQ_API_KEY),
    openReports: counts.open,
    acknowledgedReports: counts.acknowledged,
    reportsLast24h: counts.last24h,
    retrying: jobCounts.retrying,
    failedLast24h: jobCounts.failed,
    lastFailure: lastFailure
      ? `${lastFailure.kind}: ${lastFailure.error ?? "unknown error"}`
      : null,
  };
}

export async function handleStatusCommand(ctx: Ctx): Promise<HandlerResult> {
  const { settings } = ctx.rules.status;
  const snapshot = await statusSnapshot(ctx.tx, ctx.guild, ctx.rules, ctx.now);

  if (settings.mirror && ctx.guild.mirrorKind) {
    await enqueue(ctx.tx, {
      guildId: ctx.guild.id,
      interactionId: ctx.interaction.id,
      kind: "mirror",
      payload: { kind: "mirror", event: "status_check", actor: ctx.actor.name },
    });
  }

  return {
    result: "accepted",
    response: {
      type: ResponseType.ChannelMessage,
      data: statusMessage(snapshot, settings.visibility, ctx.now),
    },
  };
}

export async function handleStatusRefresh(ctx: Ctx): Promise<HandlerResult> {
  const snapshot = await statusSnapshot(ctx.tx, ctx.guild, ctx.rules, ctx.now);
  const { flags: _flags, ...data } = statusMessage(
    snapshot,
    ctx.rules.status.settings.visibility,
    ctx.now,
  );
  // Flags can't be changed on an existing message, so they're left out of the update.
  return { result: "accepted", response: { type: ResponseType.UpdateMessage, data } };
}
