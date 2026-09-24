import "server-only";
import { timingSafeEqual } from "node:crypto";
import { env } from "../env";
import { log } from "../log";
import { clearExpiredTokens, drainJobs } from "./runner";

function authorized(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${env().CRON_SECRET}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Called every minute by Supabase pg_cron (and daily by Vercel cron as a backstop). Picks up
// retries that are due and jobs whose worker died mid-flight.
export async function handleSweepRequest(req: Request, budgetMs = 45_000) {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const started = Date.now();
  const summary = await drainJobs({ budgetMs, batch: 10 });
  await clearExpiredTokens();
  log.info("sweep.done", { ...summary, durationMs: Date.now() - started });
  return Response.json(summary);
}
