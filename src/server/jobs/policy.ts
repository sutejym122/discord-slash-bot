import type { JobKind } from "../db/schema";

type Policy = { maxAttempts: number; baseDelayMs: number; maxDelayMs: number };

// Triage retries fast and gives up early because the reporter is watching their receipt; the
// report goes out without a summary rather than waiting. The reply edits the original
// interaction response, whose token dies after 15 minutes, so retrying past that is pointless.
// Channel posts and mirrors can wait: roughly an hour of retries in total.
const POLICIES: Record<JobKind, Policy> = {
  triage: { maxAttempts: 3, baseDelayMs: 2_000, maxDelayMs: 10_000 },
  reply: { maxAttempts: 5, baseDelayMs: 3_000, maxDelayMs: 120_000 },
  channel_post: { maxAttempts: 8, baseDelayMs: 5_000, maxDelayMs: 30 * 60_000 },
  mirror: { maxAttempts: 8, baseDelayMs: 5_000, maxDelayMs: 30 * 60_000 },
};

export function policyFor(kind: JobKind): Policy {
  return POLICIES[kind];
}

// Exponential backoff (x3) with +/-20% jitter so a burst of failures doesn't retry in lockstep.
// A Retry-After from the upstream wins when it asks for longer.
export function retryDelayMs(
  kind: JobKind,
  attempt: number,
  retryAfterMs?: number,
  random = Math.random,
) {
  const { baseDelayMs, maxDelayMs } = POLICIES[kind];
  const exp = Math.min(maxDelayMs, baseDelayMs * 3 ** Math.max(0, attempt - 1));
  const jittered = Math.round(exp * (0.8 + random() * 0.4));
  return Math.max(jittered, retryAfterMs ?? 0);
}
