# AI notes

## Tools and how the work was split

I built this with Claude (model `claude-opus-5-5`, in Claude's Cowork mode) as my main pair.
The context files are in the repo exactly as used: `CLAUDE.md`, which I kept up to date as the
project grew, and `AGENTS.md`, which Next.js generates and `CLAUDE.md` pulls in.

- **Me:** the brief, the quality bar and the architecture calls. I also did every account,
  secret and deployment step, and the live end-to-end checks against Discord, Supabase and
  Vercel.
- **Claude:** most of the code and tests, first drafts of the docs, and research into
  current free-tier limits.
- **How we worked:** I put the constraints in the brief instead of correcting output after
  the fact. Nothing counted as done until a test or a live run showed it working.

## Decisions I made

**Idempotency lives in the database and survives concurrency.**
The interaction id is the primary key of `interactions`. It's the first insert of the
transaction that also writes the report, the jobs and the exact response sent to Discord. A
concurrent duplicate blocks on that key, then replays the stored response and does nothing
else. I asked for concurrent duplicates to be tested, not just sequential ones. The test fires
8 identical deliveries at once and asserts one report, one set of jobs and identical
responses.

**A database outbox instead of "call Slack after responding".**
A background promise after the reply silently loses work if it fails or the function is
recycled. So:

- Every side effect is a `jobs` row, written in the same transaction as the interaction.
- Jobs are claimed with `SKIP LOCKED` plus a lease, and every attempt is recorded.
- Errors are classed as retryable or permanent. A deleted webhook fails once with a clear
  reason instead of retrying for an hour.

**Hosting checked against current free-tier limits, not assumed.**

- Cloudflare Workers caps free CPU at 10 ms, and password hashing alone exceeds that.
- Render's free tier sleeps, so a cold start would miss Discord's 3-second window.
- Vercel Hobby only allows daily cron. Supabase `pg_cron` + `pg_net` call the sweep every
  minute instead, so the database that holds the queue also runs its clock.
- That always-on sweep is also why I picked Supabase over Neon: it would burn Neon's free
  compute hours.

## The hardest bug the AI walked me into

One integration test kept failing ("Discord's 3-second window"): a report's AI status was
still `pending` after the worker finished. It passed every time it ran alone, which made it
look like a race in the job runner.

- **What was wrong.** The cause was the test Claude wrote just before it, for HTTP timeouts.
  - That test used `vi.useFakeTimers()` to skip an 8-second timeout, but
    `AbortSignal.timeout()` isn't driven by faked timers. Vitest abandoned the test at 15
    seconds.
  - Its `drainJobs` loop kept running in the background, claimed the *next* test's triage
    job, and ran it against a fetch stub that no longer existed.
- **How it showed.** The failure passed in isolation and had nothing to do with timeouts. That
  pointed at the tests interfering with each other rather than at the runner.
- **The fix.** The real timeout is now unit-tested against a small local HTTP server with a
  200 ms timeout. The job-level test has the fake `fetch` throw the same `TimeoutError` the
  platform would.
- **The lesson.** A background loop that outlives its test turns a shared database into
  cross-test interference, and the symptom shows up somewhere else.

## What production caught

The first `pg_cron` job pointed at the app's root URL instead of `/api/jobs/sweep`. Every call
returned `200` with the landing page, so the scheduler looked healthy while retries weren't
being swept. I found it during live verification, rescheduled the job at the right endpoint,
and confirmed that a simulated mirror outage recovered.

A `200` clearly isn't proof the sweep runs, so I made the app notice for itself:

- Each sweep records a heartbeat.
- `/api/health` reports `degraded` after three missed minutes, and the dashboard shows the
  same warning.
- `supabase/cron.sql` now takes the full sweep URL and describes what a healthy response
  looks like.

## From my brief

> Deduplicate using the Discord interaction ID. This must be enforced at the
> persistence/database level, not only by an in-memory check. Think about concurrent
> duplicate deliveries. [...] Do not rely solely on fire-and-forget promises or an in-memory
> queue.

## With more time

- **Streaming updates:** stream the activity log instead of polling every 4 seconds.
- **Email invites:** today owners share with accounts the operator has already created.
- **Mirror dedupe:** a delivery marker in mirror messages, so the rare at-least-once duplicate
  is recognisable.
- **Retention:** a job that prunes old interactions and attempts.
