import "server-only";
import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db, type Tx } from "../db/client";
import { guilds, interactions, type Job, jobAttempts, jobs, reports } from "../db/schema";
import { log } from "../log";
import { JobError } from "./errors";
import { degradeTriage, type JobContext, runHandler } from "./handlers";
import { retryDelayMs } from "./policy";

// How long a claimed job stays invisible to other workers. Longer than any single handler can
// take (HTTP timeouts are 8-10s), so a live worker never loses its lease; a crashed one's jobs
// come back after this.
const LEASE_SECONDS = 60;

export async function claimJobs(opts: { limit: number; interactionId?: string; now?: Date }) {
  const now = opts.now ?? new Date();
  const scope = opts.interactionId ? sql`and ${jobs.interactionId} = ${opts.interactionId}` : sql``;
  // SKIP LOCKED lets the post-response drain and the minute sweep run at the same time
  // without ever picking up the same job.
  const rows = await db().execute<{ id: string }>(sql`
    update ${jobs} set
      status = 'running',
      attempts = ${jobs.attempts} + 1,
      locked_until = ${now.toISOString()}::timestamptz + make_interval(secs => ${LEASE_SECONDS}),
      updated_at = ${now.toISOString()}::timestamptz
    where ${jobs.id} in (
      select ${jobs.id} from ${jobs}
      where (
        (${jobs.status} in ('pending', 'retrying') and ${jobs.runAt} <= ${now.toISOString()}::timestamptz)
        or (${jobs.status} = 'running' and ${jobs.lockedUntil} < ${now.toISOString()}::timestamptz)
      ) ${scope}
      order by ${jobs.runAt}
      limit ${opts.limit}
      for update skip locked
    )
    returning ${jobs.id}
  `);
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];
  return db().query.jobs.findMany({ where: inArray(jobs.id, ids) });
}

async function loadContext(job: Job, now: Date): Promise<JobContext> {
  const [guild, interaction, report] = await Promise.all([
    db().query.guilds.findFirst({ where: eq(guilds.id, job.guildId) }),
    db().query.interactions.findFirst({ where: eq(interactions.id, job.interactionId) }),
    job.reportId ? db().query.reports.findFirst({ where: eq(reports.id, job.reportId) }) : null,
  ]);
  if (!guild || !interaction) throw new Error(`Job ${job.id} references missing rows`);
  return { job, guild, interaction, report: report ?? null, now };
}

type Result = "succeeded" | "retrying" | "failed";

export async function runJob(job: Job, now = new Date()): Promise<Result> {
  const started = performance.now();
  const logger = log.child({
    jobId: job.id,
    kind: job.kind,
    attempt: job.attempts,
    interactionId: job.interactionId,
    guildId: job.guildId,
  });

  // Fencing: only the worker holding this exact attempt may record its outcome. If our lease
  // expired and someone else re-claimed the job, attempts has moved on and our writes no-op.
  const stillOurs = and(
    eq(jobs.id, job.id),
    eq(jobs.status, "running"),
    eq(jobs.attempts, job.attempts),
  );

  let ctx: JobContext | undefined;
  let error: unknown;
  let commit: ((tx: Tx) => Promise<void>) | undefined;

  if (job.attempts > job.maxAttempts) {
    // Happens only when a worker died mid-attempt on the last try.
    error = new JobError(false, "abandoned", "Worker stopped during the final attempt");
  } else {
    try {
      ctx = await loadContext(job, now);
      commit = (await runHandler(ctx)).commit;
    } catch (e) {
      error = e;
    }
  }

  const durationMs = Math.round(performance.now() - started);
  const jobError =
    error instanceof JobError
      ? error
      : error
        ? new JobError(
            true,
            "internal_error",
            error instanceof Error ? error.message : String(error),
          )
        : undefined;
  const finalAttempt = job.attempts >= job.maxAttempts;
  const result: Result = !jobError
    ? "succeeded"
    : jobError.retryable && !finalAttempt
      ? "retrying"
      : "failed";

  await db().transaction(async (tx) => {
    const [owned] = await tx
      .update(jobs)
      .set(
        result === "succeeded"
          ? {
              status: "succeeded",
              lockedUntil: null,
              finishedAt: now,
              lastError: null,
              lastErrorCode: null,
            }
          : result === "retrying"
            ? {
                status: "retrying",
                lockedUntil: null,
                runAt: new Date(
                  now.getTime() + retryDelayMs(job.kind, job.attempts, jobError?.retryAfterMs),
                ),
                lastError: jobError?.message,
                lastErrorCode: jobError?.code,
              }
            : {
                status: "failed",
                lockedUntil: null,
                finishedAt: now,
                lastError: jobError?.message,
                lastErrorCode: jobError?.code,
              },
      )
      .where(stillOurs)
      .returning({ id: jobs.id });
    if (!owned) {
      logger.warn("job.lease_lost");
      return;
    }

    await tx.insert(jobAttempts).values({
      jobId: job.id,
      attempt: job.attempts,
      outcome: !jobError ? "succeeded" : jobError.retryable ? "retryable_error" : "permanent_error",
      httpStatus: jobError?.httpStatus ?? null,
      error: jobError ? `${jobError.code}: ${jobError.message}`.slice(0, 1000) : null,
      durationMs,
      startedAt: now,
    });

    if (result === "succeeded" && commit) await commit(tx);
    if (result === "failed" && job.kind === "triage" && ctx) {
      await degradeTriage(tx, ctx, jobError?.message ?? "unknown error");
    }
    // The token is only needed to edit the reply; drop it as soon as that's settled.
    if (job.kind === "reply" && result !== "retrying") {
      await tx
        .update(interactions)
        .set({ tokenEncrypted: null })
        .where(eq(interactions.id, job.interactionId));
    }
  });

  const fields = { durationMs, result, code: jobError?.code, httpStatus: jobError?.httpStatus };
  if (result === "succeeded") logger.info("job.succeeded", fields);
  else if (result === "retrying")
    logger.warn("job.retrying", { ...fields, error: jobError?.message });
  else logger.error("job.failed", { ...fields, error: jobError?.message });
  return result;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs due jobs until there are none or the time budget is spent. With an interactionId it
 * only touches that interaction's jobs and also waits for short retries (e.g. a triage retry
 * in 2s), so a typical report finishes within the same invocation. Anything left over is
 * picked up by the minute sweep.
 */
export async function drainJobs(opts: {
  budgetMs: number;
  interactionId?: string;
  batch?: number;
}) {
  const deadline = Date.now() + opts.budgetMs;
  const summary = { succeeded: 0, retrying: 0, failed: 0 };

  while (Date.now() < deadline - 1_000) {
    const claimed = await claimJobs({ limit: opts.batch ?? 5, interactionId: opts.interactionId });
    if (claimed.length > 0) {
      const results = await Promise.allSettled(claimed.map((j) => runJob(j)));
      for (const r of results) {
        if (r.status === "fulfilled") summary[r.value] += 1;
        else log.error("job.run_crashed", { error: r.reason });
      }
      continue;
    }
    if (!opts.interactionId) break;

    const next = await db().query.jobs.findFirst({
      where: and(
        eq(jobs.interactionId, opts.interactionId),
        inArray(jobs.status, ["pending", "retrying"]),
      ),
      orderBy: jobs.runAt,
      columns: { runAt: true },
    });
    if (!next) break;
    const wait = next.runAt.getTime() - Date.now();
    if (wait > deadline - Date.now() - 2_000) break;
    await sleep(Math.max(wait, 50));
  }
  return summary;
}

export async function clearExpiredTokens(now = new Date()) {
  await db()
    .update(interactions)
    .set({ tokenEncrypted: null })
    .where(and(isNotNull(interactions.tokenEncrypted), lt(interactions.tokenExpiresAt, now)));
}
