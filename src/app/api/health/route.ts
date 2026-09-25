import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { env } from "@/server/env";
import { sweepStatus } from "@/server/jobs/heartbeat";
import { log } from "@/server/log";

// Public and cheap: says whether the app can reach its database, whether the job queue is
// keeping up and whether the minute sweep is actually being called. No ids, per-server counts
// or configuration values.
export async function GET() {
  try {
    const [queue] = await db().execute<{ due: number; oldest_due_seconds: number | null }>(sql`
      select count(*)::int as due,
        extract(epoch from now() - min(run_at))::int as oldest_due_seconds
      from jobs
      where status in ('pending', 'retrying') and run_at <= now()
    `);
    const sweep = await sweepStatus();
    return Response.json(
      {
        status: sweep.stale ? "degraded" : "ok",
        database: "ok",
        queue: { due: queue.due, oldestDueSeconds: queue.oldest_due_seconds },
        sweep,
        ai: Boolean(env().GROQ_API_KEY),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    log.error("health.failed", { error });
    return Response.json({ status: "degraded", database: "unreachable" }, { status: 503 });
  }
}
