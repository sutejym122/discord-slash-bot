# AI notes

## Tools and how the work was split

I built this with Claude (Anthropic, used through Claude's Cowork mode) as the main pair.
`CLAUDE.md` in the repo is the context file it worked from. I didn't use any other rules
files.

- **What I did.** I wrote the brief: the quality bar, what counted as done, and what I
  wouldn't accept, such as in-memory dedupe, fire-and-forget side effects, or secrets in the
  browser. I made the calls on architecture and trade-offs, did every account and secret setup
  step myself, and ran the live end-to-end checks against Discord.
- **What Claude did.** Most of the code and tests, the first drafts of the docs, and the
  research into free-tier limits.
- **How I worked with it.** I pushed back on or reshaped proposals where noted below. Nothing
  counted as done until a test or a live run showed it working.

## Decisions I made

**1. Idempotency has to live in the database and survive concurrency.**
Discord can deliver the same interaction more than once. I didn't want a check-then-insert
that two simultaneous requests could both pass. The interaction id is the primary key of
`interactions`, and it's the first insert of the transaction that also writes the report, the
jobs and the exact response. A concurrent duplicate blocks on that key, then replays the
stored response. I asked for a test that fires 8 identical deliveries at once. It asserts one
report, one set of jobs and identical responses.

**2. A database outbox instead of "call Slack after responding".**
The obvious version does the slow work in a background promise after replying to Discord. If
that promise fails or the function is recycled, the notification silently disappears. Instead:

- Every side effect is a `jobs` row written in the same transaction as the interaction.
- Jobs are claimed with `SKIP LOCKED` and a lease, and every attempt is recorded.
- Errors are split into retryable and permanent, so a deleted webhook fails once with a clear
  reason instead of retrying for an hour.

**3. Hosting that fits a 3-second deadline on free tiers.**
I asked for this to be checked against current limits rather than assumed.

- Cloudflare Workers looked ideal, but its free plan caps CPU at 10 ms, and password hashing
  alone blows through that.
- Render's free tier sleeps, and a cold start would miss Discord's window.
- Vercel Hobby works, but only allows daily cron, and I needed retries every minute. The fix
  was to let Postgres own the clock: Supabase `pg_cron` + `pg_net` call the sweep endpoint
  every minute.
- That same always-on sweep ruled out Neon, which would burn its free compute hours staying
  awake.

## The hardest bug the AI walked me into

The integration suite had one flaky failure. The "Discord's 3-second window" test said a
report's AI status was still `pending` after the worker finished, but it passed every time it
ran on its own. That made it look like a race in the job runner, which would have been a real
problem.

- **The actual cause** was in the test Claude had written just before it, for HTTP timeouts.
  That test used `vi.useFakeTimers()` to skip an 8-second timeout. But
  `AbortSignal.timeout()` isn't driven by faked `setTimeout`, so nothing sped up and Vitest
  abandoned the test at 15 seconds.
- **Why it hit a different test.** The test's `drainJobs` loop had a longer budget and kept
  running in the background. It then claimed the *next* test's triage job through the global
  claim query, against a fetch stub that no longer existed.
- **What gave it away.** The failure passed in isolation, and it had nothing to do with
  timeouts.
- **The fix.** The real timeout is now unit-tested against a small local HTTP server with a
  200 ms timeout. The job-level test has the fake `fetch` throw the same `TimeoutError` the
  platform would.
- **The lesson.** A background loop that outlives its test turns a shared database into
  cross-test interference, and the symptom shows up somewhere else. It's also a reminder that
  the runner really does grab any due job. That's what I want in production, and exactly why
  tests need to clean up after themselves.

## With more time

- **Streamed activity updates.** The dashboard polls every 4 seconds. Server-sent events would
  work, but serverless functions make them awkward.
- **Dashboard roles.** Invite another admin to a server without them reinstalling the bot.
- **Better mirror dedupe.** Only an idempotency key on the Slack/Discord side would fully close
  the at-least-once window for mirrors. Short of that, I'd record a per-job delivery marker in
  the message text so a duplicate is at least recognisable.
- **Retention.** A job that prunes old interactions and attempts.
