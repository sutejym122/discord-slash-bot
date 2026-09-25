import { asc, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as healthRoute } from "@/app/api/health/route";
import { encrypt } from "@/server/crypto";
import { closeDb, db } from "@/server/db/client";
import { interactions, jobAttempts, jobs, reports } from "@/server/db/schema";
import { handleInteractionRequest } from "@/server/interactions/endpoint";
import { claimJobs, drainJobs, runJob } from "@/server/jobs/runner";
import { handleSweepRequest } from "@/server/jobs/sweep";
import { createGuild, resetDb, setRule } from "../support/db";
import { command, signedRequest } from "../support/discord";
import {
  DISCORD_EDIT,
  DISCORD_POST,
  DISCORD_WEBHOOK,
  fakeHttp,
  GROQ,
  goodTriage,
  groqReply,
  SLACK,
} from "../support/fake-http";

const SLACK_URL = "https://hooks.slack.com/services/T0000/B0000/abcdefabcdef";

let http: ReturnType<typeof fakeHttp>;

beforeEach(async () => {
  await resetDb();
  http = fakeHttp();
  http.on(GROQ, groqReply(goodTriage));
  http.on(DISCORD_EDIT, { json: {} });
  http.on(DISCORD_POST, { json: { id: "800000000000000001", channel_id: "700000000000000001" } });
  http.on(SLACK, { text: "ok" });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(closeDb);

async function connectedGuild(overrides = {}) {
  return createGuild({
    alertChannelId: "700000000000000001",
    alertChannelName: "alerts",
    mirrorKind: "slack",
    mirrorUrlEncrypted: encrypt(SLACK_URL),
    mirrorUrlHint: "hooks.slack.com/…cdef",
    ...overrides,
  });
}

async function fileReport(guildId: string, details = "Voice keeps dropping for everyone") {
  const res = await handleInteractionRequest(
    signedRequest(command("report", { details, severity: "medium" }, { guildId })),
    { schedule: () => {} },
  );
  return res.json();
}

const jobByKind = async (kind: "triage" | "reply" | "channel_post" | "mirror") =>
  db().query.jobs.findFirst({ where: eq(jobs.kind, kind) });

// Makes every waiting retry due now, instead of sleeping through real backoff.
const fastForward = () => db().update(jobs).set({ runAt: sql`now() - interval '1 second'` });

describe("happy path", () => {
  it("triages, then replies, posts to the alert channel and mirrors", async () => {
    const guild = await connectedGuild();
    await fileReport(guild.id);
    const summary = await drainJobs({ budgetMs: 10_000 });

    expect(summary).toEqual({ succeeded: 4, retrying: 0, failed: 0 });
    const [report] = await db().select().from(reports);
    expect(report).toMatchObject({
      aiStatus: "done",
      aiSeverity: "high",
      aiTags: ["voice", "disconnects"],
    });

    const [edit] = http.callsTo(DISCORD_EDIT);
    expect(edit.method).toBe("PATCH");
    expect(JSON.stringify(edit.body)).toContain("Shared with moderators in #alerts");

    // AI said high, reporter said medium: routing uses the higher one by default.
    const [post] = http.callsTo(DISCORD_POST);
    expect(post.headers.authorization).toMatch(/^Bot /);
    expect(post.body).toMatchObject({ enforce_nonce: true });
    expect(JSON.stringify(post.body)).toContain('"value":"High"');
    expect(report.alertMessageId).toBe("800000000000000001");

    const [slack] = http.callsTo(SLACK);
    expect((slack.body as { text: string }).text).toContain("new high report #1");

    // The token is dropped once the reply no longer needs it.
    const [row] = await db().select().from(interactions);
    expect(row.tokenEncrypted).toBeNull();
  });

  it("does not post or mirror below the configured severity", async () => {
    const guild = await connectedGuild();
    await setRule(guild.id, "report", true, {
      aiTriage: false,
      alertMinSeverity: "high",
      mirrorMinSeverity: null,
    });
    await fileReport(guild.id);
    await drainJobs({ budgetMs: 5_000 });
    expect(http.callsTo(DISCORD_POST)).toHaveLength(0);
    expect(http.callsTo(SLACK)).toHaveLength(0);
    expect(http.callsTo(DISCORD_EDIT)).toHaveLength(1);
  });

  it("pings the configured role only at or above its threshold", async () => {
    const guild = await connectedGuild();
    await setRule(guild.id, "report", true, {
      pingRoleId: "900000000000000001",
      pingMinSeverity: "high",
    });
    await fileReport(guild.id);
    await drainJobs({ budgetMs: 10_000 });
    const [post] = http.callsTo(DISCORD_POST);
    expect(post.body).toMatchObject({
      content: "<@&900000000000000001>",
      allowed_mentions: { parse: [], roles: ["900000000000000001"] },
    });
  });
});

describe("AI failures degrade instead of losing the report", () => {
  it("retries a provider outage, then files the report without a summary", async () => {
    http.on(GROQ, { status: 503, text: "upstream down" });
    const guild = await connectedGuild();
    await fileReport(guild.id);

    for (let i = 0; i < 3; i++) {
      await drainJobs({ budgetMs: 3_000 });
      await fastForward();
    }
    await drainJobs({ budgetMs: 5_000 });

    const triage = await jobByKind("triage");
    expect(triage).toMatchObject({
      status: "failed",
      attempts: 3,
      lastErrorCode: "groq_unavailable",
    });
    const [report] = await db().select().from(reports);
    expect(report.aiStatus).toBe("failed");
    expect(http.callsTo(GROQ)).toHaveLength(3);
    expect(JSON.stringify(http.callsTo(DISCORD_EDIT)[0].body)).toContain("Unavailable right now");
    expect(http.callsTo(DISCORD_POST)).toHaveLength(1);
    expect(http.callsTo(SLACK)).toHaveLength(1);
  });

  it("retries malformed model output and succeeds on the next attempt", async () => {
    http.on(GROQ, groqReply("Sure! Here is the triage: {"), groqReply(goodTriage));
    const guild = await connectedGuild();
    await fileReport(guild.id);

    await drainJobs({ budgetMs: 2_000 });
    const afterFirst = await jobByKind("triage");
    expect(afterFirst).toMatchObject({ status: "retrying", lastErrorCode: "ai_invalid_output" });

    await fastForward();
    await drainJobs({ budgetMs: 5_000 });
    const [report] = await db().select().from(reports);
    expect(report.aiStatus).toBe("done");
  });

  it("rejects output that is JSON but breaks the schema", async () => {
    http.on(GROQ, groqReply({ ...goodTriage, severity: "apocalyptic" }));
    const guild = await connectedGuild();
    await fileReport(guild.id);
    await drainJobs({ budgetMs: 2_000 });
    const triage = await jobByKind("triage");
    expect(triage?.lastError).toMatch(/failed validation: severity/);
  });

  it("honours Retry-After on rate limits", async () => {
    http.on(GROQ, { status: 429, headers: { "retry-after": "30" }, json: {} });
    const guild = await connectedGuild();
    await fileReport(guild.id);
    const before = Date.now();
    await drainJobs({ budgetMs: 1_500 });
    const triage = await jobByKind("triage");
    expect(triage?.status).toBe("retrying");
    expect(triage?.lastErrorCode).toBe("groq_rate_limited");
    expect(triage?.runAt.getTime()).toBeGreaterThanOrEqual(before + 29_000);
  });

  it("gives up straight away on a bad API key", async () => {
    http.on(GROQ, { status: 401, json: { error: "invalid key" } });
    const guild = await connectedGuild();
    await fileReport(guild.id);
    await drainJobs({ budgetMs: 5_000 });
    expect(await jobByKind("triage")).toMatchObject({ status: "failed", attempts: 1 });
    const [report] = await db().select().from(reports);
    expect(report.aiStatus).toBe("failed");
  });
});

describe("mirror delivery", () => {
  it("retries a failing webhook and records the recovery", async () => {
    http.on(SLACK, { status: 503 }, { status: 502 }, { text: "ok" });
    const guild = await connectedGuild();
    await setRule(guild.id, "report", true, { aiTriage: false });
    await fileReport(guild.id);

    await drainJobs({ budgetMs: 2_000 });
    expect(await jobByKind("mirror")).toMatchObject({ status: "retrying", attempts: 1 });
    await fastForward();
    await drainJobs({ budgetMs: 2_000 });
    await fastForward();
    await drainJobs({ budgetMs: 2_000 });

    const mirror = await jobByKind("mirror");
    expect(mirror).toMatchObject({ status: "succeeded", attempts: 3, lastError: null });
    const attempts = await db()
      .select()
      .from(jobAttempts)
      .where(eq(jobAttempts.jobId, mirror?.id as string))
      .orderBy(asc(jobAttempts.attempt));
    expect(attempts.map((a) => [a.outcome, a.httpStatus])).toEqual([
      ["retryable_error", 503],
      ["retryable_error", 502],
      ["succeeded", null],
    ]);
  });

  it("fails permanently and visibly when the webhook was deleted", async () => {
    http.on(SLACK, { status: 404, text: "no_service" });
    const guild = await connectedGuild();
    await setRule(guild.id, "report", true, { aiTriage: false });
    await fileReport(guild.id);
    await drainJobs({ budgetMs: 2_000 });
    expect(await jobByKind("mirror")).toMatchObject({
      status: "failed",
      attempts: 1,
      lastErrorCode: "mirror_webhook_not_found",
    });
  });

  it("stops after the maximum number of attempts", async () => {
    http.on(SLACK, { status: 500 });
    const guild = await connectedGuild();
    await setRule(guild.id, "report", true, { aiTriage: false });
    await fileReport(guild.id);
    for (let i = 0; i < 10; i++) {
      await drainJobs({ budgetMs: 1_500 });
      await fastForward();
    }
    expect(await jobByKind("mirror")).toMatchObject({ status: "failed", attempts: 8 });
    expect(http.callsTo(SLACK)).toHaveLength(8);
  });

  it("treats a timeout as retryable", async () => {
    http.on(SLACK, { timeout: true });
    const guild = await connectedGuild();
    await setRule(guild.id, "report", true, { aiTriage: false });
    await fileReport(guild.id);
    await drainJobs({ budgetMs: 2_000 });
    expect(await jobByKind("mirror")).toMatchObject({
      status: "retrying",
      lastErrorCode: "slack_timeout",
    });
  });

  it("uses the simulated outage without calling the real webhook", async () => {
    const guild = await connectedGuild({ mirrorOutageUntil: new Date(Date.now() + 60_000) });
    await setRule(guild.id, "report", true, { aiTriage: false });
    await fileReport(guild.id);
    await drainJobs({ budgetMs: 2_000 });
    expect(await jobByKind("mirror")).toMatchObject({
      status: "retrying",
      lastErrorCode: "mirror_simulated_outage",
    });
    expect(http.callsTo(SLACK)).toHaveLength(0);
  });

  it("sends Discord webhooks with mentions disabled", async () => {
    http.on(DISCORD_WEBHOOK, { status: 204 });
    const guild = await connectedGuild({
      mirrorKind: "discord",
      mirrorUrlEncrypted: encrypt(
        "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz",
      ),
    });
    await setRule(guild.id, "report", true, { aiTriage: false });
    await fileReport(guild.id, "@everyone look at this");
    await drainJobs({ budgetMs: 2_000 });
    const [call] = http.callsTo(DISCORD_WEBHOOK);
    expect(call.body).toMatchObject({ allowed_mentions: { parse: [] } });
  });

  it("never writes the webhook URL to the logs", async () => {
    http.on(SLACK, { status: 500, text: "boom" });
    process.env.LOG_LEVEL = "debug";
    const lines: string[] = [];
    const capture = (s: string) => lines.push(s);
    const out = vi.spyOn(console, "log").mockImplementation(capture);
    const err = vi.spyOn(console, "error").mockImplementation(capture);
    const guild = await connectedGuild();
    await setRule(guild.id, "report", true, { aiTriage: false });
    await fileReport(guild.id);
    await drainJobs({ budgetMs: 2_000 });
    out.mockRestore();
    err.mockRestore();
    process.env.LOG_LEVEL = "error";
    expect(lines.some((l) => l.includes("job.retrying"))).toBe(true);
    expect(lines.join("\n")).not.toContain("abcdefabcdef");
  });
});

describe("reply and alert failures", () => {
  it("does not retry a reply whose interaction token has expired", async () => {
    const guild = await connectedGuild();
    await setRule(guild.id, "report", true, { aiTriage: false });
    await fileReport(guild.id);
    await db()
      .update(interactions)
      .set({ tokenExpiresAt: new Date(Date.now() - 1000) });
    await drainJobs({ budgetMs: 2_000 });
    expect(await jobByKind("reply")).toMatchObject({
      status: "failed",
      lastErrorCode: "interaction_token_expired",
    });
    expect(http.callsTo(DISCORD_EDIT)).toHaveLength(0);
  });

  it("marks a channel post permanently failed when the bot lost access", async () => {
    http.on(DISCORD_POST, { status: 403, json: { message: "Missing Access", code: 50001 } });
    const guild = await connectedGuild();
    await setRule(guild.id, "report", true, { aiTriage: false });
    await fileReport(guild.id);
    await drainJobs({ budgetMs: 2_000 });
    expect(await jobByKind("channel_post")).toMatchObject({
      status: "failed",
      lastErrorCode: "missing_channel_access",
    });
  });
});

describe("concurrency and crash recovery", () => {
  it("never runs a job twice when two workers drain at once", async () => {
    const guild = await connectedGuild();
    for (let i = 0; i < 4; i++) await fileReport(guild.id, `report ${i}`);
    await Promise.all([
      drainJobs({ budgetMs: 10_000, batch: 3 }),
      drainJobs({ budgetMs: 10_000, batch: 3 }),
      drainJobs({ budgetMs: 10_000, batch: 3 }),
    ]);
    expect(http.callsTo(GROQ)).toHaveLength(4);
    expect(http.callsTo(DISCORD_POST)).toHaveLength(4);
    expect(http.callsTo(SLACK)).toHaveLength(4);
    const statuses = (await db().select().from(jobs)).map((j) => j.status);
    expect(statuses.every((s) => s === "succeeded")).toBe(true);
  });

  it("picks up a job whose worker died, once its lease expires", async () => {
    const guild = await connectedGuild();
    await setRule(guild.id, "report", true, { aiTriage: false });
    await fileReport(guild.id);
    // Simulate a crash: claim everything, never finish.
    const claimed = await claimJobs({ limit: 10 });
    expect(claimed).toHaveLength(3);
    expect(await claimJobs({ limit: 10 })).toHaveLength(0);

    await db().update(jobs).set({ lockedUntil: sql`now() - interval '1 second'` });
    await drainJobs({ budgetMs: 3_000 });
    const all = await db().select().from(jobs);
    expect(all.every((j) => j.status === "succeeded" && j.attempts === 2)).toBe(true);
  });

  it("ignores the result of a worker that lost its lease", async () => {
    const guild = await connectedGuild();
    await setRule(guild.id, "report", true, { aiTriage: false });
    await fileReport(guild.id);
    const [stale] = (await claimJobs({ limit: 10 })).filter((j) => j.kind === "mirror");
    // Someone else re-claims it after the lease expired and bumps the attempt number.
    await db().update(jobs).set({ lockedUntil: sql`now() - interval '1 second'` });
    await claimJobs({ limit: 10 });

    await runJob(stale);
    const mirror = await jobByKind("mirror");
    expect(mirror).toMatchObject({ status: "running", attempts: 2 });
    expect(await db().select().from(jobAttempts)).toHaveLength(0);
  });
});

describe("sweep endpoint", () => {
  it("requires the cron secret", async () => {
    const bad = await handleSweepRequest(
      new Request("http://x/api/jobs/sweep", { headers: { authorization: "Bearer nope" } }),
    );
    expect(bad.status).toBe(401);
  });

  it("runs due work", async () => {
    const guild = await connectedGuild();
    await setRule(guild.id, "report", true, { aiTriage: false });
    await fileReport(guild.id);
    const res = await handleSweepRequest(
      new Request("http://x/api/jobs/sweep", {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      }),
      5_000,
    );
    expect(await res.json()).toEqual({ succeeded: 3, retrying: 0, failed: 0 });
  });

  it("records a heartbeat so a broken scheduler shows up in /api/health", async () => {
    const before = await (await healthRoute()).json();
    expect(before).toMatchObject({ status: "degraded", sweep: { lastRunAt: null, stale: true } });

    await handleSweepRequest(
      new Request("http://x/api/jobs/sweep", {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      }),
      1_000,
    );
    const after = await (await healthRoute()).json();
    expect(after).toMatchObject({ status: "ok", database: "ok", sweep: { stale: false } });
    expect(JSON.stringify(after)).not.toMatch(/secret|token|hooks/i);
  });
});

describe("Discord's 3 second window", () => {
  it("responds before slow AI work runs", async () => {
    http.on(GROQ, { ...groqReply(goodTriage), delayMs: 2_500 });
    const guild = await connectedGuild();
    let drain: Promise<unknown> | undefined;
    const started = performance.now();
    const res = await handleInteractionRequest(
      signedRequest(command("report", { details: "slow one" }, { guildId: guild.id })),
      {
        schedule: (task) => {
          drain = task();
        },
        onAccepted: (id) => drainJobs({ interactionId: id, budgetMs: 10_000 }).then(() => {}),
      },
    );
    const elapsed = performance.now() - started;

    expect(res.status).toBe(200);
    expect((await res.json()).data.content).toContain("Triaging it now");
    expect(elapsed).toBeLessThan(1_000);

    await drain;
    const [report] = await db().select().from(reports);
    expect(report.aiStatus).toBe("done");
    expect(http.callsTo(DISCORD_EDIT)).toHaveLength(1);
  });
});
