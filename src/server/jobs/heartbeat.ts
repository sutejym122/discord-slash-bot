import "server-only";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { heartbeats } from "../db/schema";

// pg_cron calls the sweep every minute. Three missed runs means the scheduler is broken or
// pointed at the wrong URL, which a 200 from the wrong page would otherwise hide.
export const SWEEP_STALE_AFTER_MS = 3 * 60_000;

export async function recordHeartbeat(
  name: string,
  detail: Record<string, unknown>,
  now = new Date(),
) {
  await db()
    .insert(heartbeats)
    .values({ name, lastRunAt: now, detail })
    .onConflictDoUpdate({ target: heartbeats.name, set: { lastRunAt: now, detail } });
}

export async function sweepStatus(now = new Date()) {
  const row = await db().query.heartbeats.findFirst({ where: eq(heartbeats.name, "sweep") });
  const lastRunAt = row?.lastRunAt ?? null;
  return {
    lastRunAt: lastRunAt?.toISOString() ?? null,
    stale: !lastRunAt || now.getTime() - lastRunAt.getTime() > SWEEP_STALE_AFTER_MS,
  };
}
