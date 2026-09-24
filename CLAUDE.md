@AGENTS.md

# Slash Bot

Take-home for Abstrabit: a Discord bot driven by HTTP interactions, plus an admin dashboard.
Admins connect a server, pick an alert channel and a mirror webhook, and set per-command rules.
`/report` (modal) and `/status` are the commands. Everything must run on free, no-card tiers.

## Stack

Next.js 16 App Router on Vercel Hobby, Supabase Postgres via Drizzle (`postgres.js`, `prepare: false`
for the transaction pooler), Better Auth (email/password, DB sessions), zod 4, Groq for AI, Tailwind 4,
Vitest against a real Postgres, Playwright for browser flows. pnpm.

## Layout

- `src/server/` is server-only code. Every module that touches secrets imports `server-only`.
  - `discord/` verification, REST client, command definitions
  - `interactions/` the interaction handler, one file per command/component
  - `jobs/` outbox queue: enqueue, claim, run, retry policy, one handler per job kind
  - `guilds/` install flow, settings, rules, and `requireGuildAdmin`
- `src/app/` routes and pages. Route handlers stay thin and call into `src/server`.
- `drizzle/` generated migrations. Never edit a migration that has been committed; add a new one.

## Rules that matter here

- **Signature first.** The interactions route reads the raw body as text, verifies Ed25519 over
  `timestamp + body` and checks timestamp freshness before anything parses it. No exceptions,
  including PING.
- **Idempotency lives in the database.** The interaction id is the primary key of `interactions`.
  The first delivery inserts the interaction, its jobs and its initial response in one
  transaction; any duplicate gets the stored response back and does nothing else. Jobs are unique on
  `(interaction_id, kind)`. Don't add in-memory dedupe as a substitute.
- **Nothing slow before the response.** The route may do one short transaction. AI calls, webhook
  calls and Discord REST calls happen in jobs, run by `after()` right away and by the minute sweep
  as the fallback. Discord gives us 3 seconds.
- **Jobs never vanish.** Every attempt writes a `job_attempts` row. Errors are classified as
  retryable (network, 5xx, 429) or permanent (4xx config problems, expired token); only retryable ones
  back off and retry. Terminal failures stay visible in the dashboard with a reason.
- **Guild isolation.** Every dashboard query and mutation goes through `requireGuildAdmin(userId,
  guildId)`. Never accept a guild id from the client without that check.
- **Secrets.** Bot token, client secret, webhook URLs, interaction tokens and API keys never reach
  the client, logs, error responses or the repo. Webhook URLs are encrypted at rest and only a masked
  hint is returned. Webhook hosts are allowlisted (Slack, Discord) to prevent SSRF.
- **Env** is validated in `src/server/env.ts`. Add new variables there and to `.env.example`.

## Conventions

- Comments explain Discord quirks, security or concurrency decisions. No narrating comments.
- Plain product names in the UI. No em dashes in prose or UI copy.
- Errors carry a stable `code` so logs and the dashboard can group them.
- Tests: `pnpm test` needs Postgres at `TEST_DATABASE_URL` (defaults to `slashbot_test` on
  localhost). External HTTP is stubbed at the `fetch` boundary, never by mocking our own modules.
- Run `pnpm check` (biome, tsc, vitest) before calling anything done.

## UI

Quiet, dense-but-calm operations UI. Warm neutral surfaces, hairline borders, one ink color for
primary actions, colour only for status (ok, retrying, failed). No gradients, glass, glow, fake
charts or KPI tiles without meaning. Every list has loading, empty and error states.
