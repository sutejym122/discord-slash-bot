import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { env } from "@/server/env";
import { log } from "@/server/log";

// Public and cheap: says whether the app can reach its database and whether the job queue is
// keeping up. No ids, counts per server or configuration values.
export async function GET() {
  try {
    const [queue] = await db().execute<{ due: number; oldest_due_seconds: number | null }>(sql`
      select count(*)::int as due,
        extract(epoch from now() - min(run_at))::int as oldest_due_seconds
      from jobs
      where status in ('pending', 'retrying') and run_at <= now()
    `);
    return Response.json(
      {
        status: "ok",
        database: "ok",
        queue: { due: queue.due, oldestDueSeconds: queue.oldest_due_seconds },
        ai: Boolean(env().GROQ_API_KEY),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    log.error("health.failed", { error });
    return Response.json({ status: "degraded", database: "unreachable" }, { status: 503 });
  }
}
