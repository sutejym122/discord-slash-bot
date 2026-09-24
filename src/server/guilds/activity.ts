import "server-only";
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "../db/client";
import { interactions, jobAttempts, jobs, reports } from "../db/schema";

export type ActivityFilter = "all" | "reports" | "attention";

const PAGE_SIZE = 40;

// Everything the activity log shows for one server. Every query is filtered by guild id,
// including the job and attempt lookups, so nothing from another server can leak in.
export async function getActivity(
  guildId: string,
  opts: { filter?: ActivityFilter; before?: Date } = {},
) {
  const filter = opts.filter ?? "all";
  const conditions = [eq(interactions.guildId, guildId)];
  if (opts.before) conditions.push(lt(interactions.receivedAt, opts.before));
  if (filter === "reports") {
    conditions.push(
      sql`exists (select 1 from ${reports} where ${reports.interactionId} = ${interactions.id})`,
    );
  }
  if (filter === "attention") {
    conditions.push(
      sql`exists (select 1 from ${jobs} where ${jobs.interactionId} = ${interactions.id}
        and ${jobs.status} in ('failed', 'retrying'))`,
    );
  }

  const rows = await db()
    .select({
      id: interactions.id,
      type: interactions.type,
      name: interactions.name,
      userName: interactions.userName,
      result: interactions.result,
      handleMs: interactions.handleMs,
      receivedAt: interactions.receivedAt,
    })
    .from(interactions)
    .where(and(...conditions))
    .orderBy(desc(interactions.receivedAt))
    .limit(PAGE_SIZE + 1);

  const page = rows.slice(0, PAGE_SIZE);
  const ids = page.map((r) => r.id);
  if (ids.length === 0) return { items: [], hasMore: false };

  const [reportRows, jobRows] = await Promise.all([
    db()
      .select()
      .from(reports)
      .where(and(eq(reports.guildId, guildId), inArray(reports.interactionId, ids))),
    db()
      .select()
      .from(jobs)
      .where(and(eq(jobs.guildId, guildId), inArray(jobs.interactionId, ids)))
      .orderBy(asc(jobs.createdAt)),
  ]);
  const attemptRows = jobRows.length
    ? await db()
        .select()
        .from(jobAttempts)
        .where(
          inArray(
            jobAttempts.jobId,
            jobRows.map((j) => j.id),
          ),
        )
        .orderBy(asc(jobAttempts.attempt))
    : [];

  const items = page.map((row) => {
    const report = reportRows.find((r) => r.interactionId === row.id);
    return {
      ...row,
      receivedAt: row.receivedAt.toISOString(),
      report: report
        ? {
            id: report.id,
            number: report.number,
            title: report.title,
            details: report.details,
            category: report.category,
            severity: report.severity,
            status: report.status,
            statusChangedBy: report.statusChangedBy,
            reporterName: report.reporterName,
            aiStatus: report.aiStatus,
            aiSummary: report.aiSummary,
            aiCategory: report.aiCategory,
            aiSeverity: report.aiSeverity,
            aiTags: report.aiTags,
            aiNextStep: report.aiNextStep,
            aiError: report.aiError,
          }
        : null,
      jobs: jobRows
        .filter((j) => j.interactionId === row.id)
        .map((j) => ({
          id: j.id,
          kind: j.kind,
          status: j.status,
          attempts: j.attempts,
          maxAttempts: j.maxAttempts,
          runAt: j.runAt.toISOString(),
          lastError: j.lastError,
          lastErrorCode: j.lastErrorCode,
          finishedAt: j.finishedAt?.toISOString() ?? null,
          history: attemptRows
            .filter((a) => a.jobId === j.id)
            .map((a) => ({
              attempt: a.attempt,
              outcome: a.outcome,
              httpStatus: a.httpStatus,
              error: a.error,
              durationMs: a.durationMs,
              startedAt: a.startedAt.toISOString(),
            })),
        })),
    };
  });

  return { items, hasMore: rows.length > PAGE_SIZE };
}

export type ActivityItem = Awaited<ReturnType<typeof getActivity>>["items"][number];

export async function deliveryHealth(guildId: string) {
  const since = new Date(Date.now() - 24 * 3600_000);
  const [row] = await db()
    .select({
      retrying: sql<number>`count(*) filter (where ${jobs.status} = 'retrying')::int`,
      running: sql<number>`count(*) filter (where ${jobs.status} in ('pending', 'running'))::int`,
      failed: sql<number>`count(*) filter (where ${jobs.status} = 'failed')::int`,
    })
    .from(jobs)
    .where(and(eq(jobs.guildId, guildId), gte(jobs.updatedAt, since)));
  return row;
}
