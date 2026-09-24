import { count, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, db } from "@/server/db/client";
import { interactions, jobs, reports } from "@/server/db/schema";
import { handleInteractionRequest } from "@/server/interactions/endpoint";
import { createGuild, resetDb, setRule } from "../support/db";
import {
  button,
  command,
  modalSubmit,
  ping,
  signBody,
  signedRequest,
  snowflake,
} from "../support/discord";

const MANAGE_MESSAGES = String(1 << 13);

function send(req: Request) {
  const scheduled: string[] = [];
  const res = handleInteractionRequest(req, {
    schedule: (task) => void task(),
    onAccepted: async (id) => {
      scheduled.push(id);
    },
  });
  return { res, scheduled };
}

async function call(payload: unknown) {
  const { res, scheduled } = send(signedRequest(payload));
  const r = await res;
  return { status: r.status, body: await r.json(), scheduled };
}

const countOf = async (table: typeof reports | typeof jobs | typeof interactions) =>
  (await db().select({ n: count() }).from(table))[0].n;

beforeEach(resetDb);
afterAll(closeDb);

describe("request verification", () => {
  it("rejects a request with no signature headers and records nothing", async () => {
    const req = new Request("http://localhost/api/discord/interactions", {
      method: "POST",
      body: JSON.stringify(command("status")),
    });
    const res = await send(req).res;
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "missing_signature" });
    expect(await countOf(interactions)).toBe(0);
  });

  it("rejects a forged signature", async () => {
    const res = await send(signedRequest(command("status"), { tamper: true })).res;
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_signature" });
  });

  it("rejects a correctly signed request that is too old", async () => {
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    const res = await send(signedRequest(command("status"), { timestamp: old })).res;
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "stale_timestamp" });
  });

  it("rejects signed garbage and signed payloads of the wrong shape", async () => {
    const garbage = "not json at all";
    const { signature, timestamp } = signBody(garbage);
    const res = await send(
      new Request("http://localhost/api/discord/interactions", {
        method: "POST",
        headers: { "x-signature-ed25519": signature, "x-signature-timestamp": timestamp },
        body: garbage,
      }),
    ).res;
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "malformed_json" });

    const wrongShape = await call({ hello: "world" });
    expect(wrongShape.status).toBe(400);
    expect(wrongShape.body).toEqual({ error: "invalid_payload" });
  });

  it("rejects interactions addressed to a different application", async () => {
    const res = await call({ ...ping(), application_id: "999999999999999999" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "wrong_application" });
  });

  it("answers PING with PONG", async () => {
    const res = await call(ping());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ type: 1 });
  });
});

describe("/report", () => {
  it("opens a modal when no details are given, preselecting chosen options", async () => {
    const guild = await createGuild();
    const res = await call(command("report", { severity: "high" }, { guildId: guild.id }));
    expect(res.body.type).toBe(9);
    expect(res.body.data.custom_id).toBe("report:modal");
    const severitySelect = res.body.data.components[2].component;
    expect(severitySelect.options.find((o: { default: boolean }) => o.default).value).toBe("high");
    expect(await countOf(reports)).toBe(0);
    expect(res.scheduled).toHaveLength(1);
  });

  it("files a report from the modal and queues triage", async () => {
    const guild = await createGuild({ alertChannelId: "700000000000000001" });
    const res = await call(
      modalSubmit(
        {
          title: "Voice keeps dropping",
          details: "Everyone in General VC disconnects every few minutes.",
          severity: "high",
          category: "bug",
        },
        { guildId: guild.id },
      ),
    );
    expect(res.body.type).toBe(4);
    expect(res.body.data.flags).toBe(64);
    expect(res.body.data.content).toContain("Report #1 received");

    const [report] = await db().select().from(reports);
    expect(report).toMatchObject({
      number: 1,
      severity: "high",
      category: "bug",
      aiStatus: "pending",
    });
    const queued = await db().select().from(jobs);
    expect(queued.map((j) => j.kind)).toEqual(["triage"]);
  });

  it("files inline reports and skips triage when the rule turns AI off", async () => {
    const guild = await createGuild({
      alertChannelId: "700000000000000001",
      mirrorKind: "discord",
      mirrorUrlEncrypted: "x",
    });
    await setRule(guild.id, "report", true, { aiTriage: false, mirrorMinSeverity: "low" });
    await call(command("report", { details: "Spam bot in #general" }, { guildId: guild.id }));

    const [report] = await db().select().from(reports);
    expect(report).toMatchObject({ title: "Spam bot in #general", aiStatus: "skipped" });
    const kinds = (await db().select().from(jobs)).map((j) => j.kind).sort();
    expect(kinds).toEqual(["channel_post", "mirror", "reply"]);
  });

  it("numbers reports per server", async () => {
    const a = await createGuild();
    const b = await createGuild();
    await call(command("report", { details: "one" }, { guildId: a.id }));
    await call(command("report", { details: "two" }, { guildId: a.id }));
    await call(command("report", { details: "three" }, { guildId: b.id }));
    const rows = await db().select().from(reports);
    expect(rows.filter((r) => r.guildId === a.id).map((r) => r.number)).toEqual([1, 2]);
    expect(rows.find((r) => r.guildId === b.id)?.number).toBe(1);
  });

  it("stores the interaction token encrypted, never in plain text", async () => {
    const guild = await createGuild();
    const payload = command("report", { details: "x" }, { guildId: guild.id });
    await call(payload);
    const [row] = await db().select().from(interactions);
    expect(row.tokenEncrypted).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain(payload.token);
  });
});

describe("duplicate delivery", () => {
  it("replays the stored response and does nothing else on a sequential duplicate", async () => {
    const guild = await createGuild();
    const payload = command("report", { details: "duplicate me" }, { guildId: guild.id });
    const first = await call(payload);
    const second = await call(payload);

    expect(second.body).toEqual(first.body);
    expect(first.scheduled).toHaveLength(1);
    expect(second.scheduled).toHaveLength(0);
    expect(await countOf(reports)).toBe(1);
    expect(await countOf(jobs)).toBe(1);
  });

  it("creates exactly one set of side effects under concurrent duplicates", async () => {
    const guild = await createGuild({ alertChannelId: "700000000000000001" });
    const payload = command("report", { details: "race" }, { guildId: guild.id });
    const results = await Promise.all(Array.from({ length: 8 }, () => call(payload)));

    for (const r of results) expect(r.body).toEqual(results[0].body);
    expect(results.flatMap((r) => r.scheduled)).toHaveLength(1);
    expect(await countOf(interactions)).toBe(1);
    expect(await countOf(reports)).toBe(1);
    expect(await countOf(jobs)).toBe(1);
  });
});

describe("server configuration", () => {
  it("records commands from servers that were never connected and explains why", async () => {
    const res = await call(command("status", {}, { guildId: snowflake() }));
    expect(res.body.data.content).toMatch(/isn't connected/);
    expect(res.scheduled).toHaveLength(0);
    const [row] = await db().select().from(interactions);
    expect(row.result).toBe("unconfigured_guild");
  });

  it("respects a disabled command", async () => {
    const guild = await createGuild();
    await setRule(guild.id, "report", false);
    const res = await call(command("report", { details: "x" }, { guildId: guild.id }));
    expect(res.body.data.content).toMatch(/turned off/);
    expect(await countOf(reports)).toBe(0);
  });

  it("refuses commands sent outside a server", async () => {
    const payload = command("status");
    const res = await call({
      ...payload,
      member: undefined,
      user: { id: "400000000000000001", username: "a" },
    });
    expect(res.body.data.content).toMatch(/inside a server/);
  });
});

describe("/status", () => {
  it("replies privately by default with a refresh button", async () => {
    const guild = await createGuild({ alertChannelName: "alerts" });
    const res = await call(command("status", {}, { guildId: guild.id }));
    expect(res.body.type).toBe(4);
    expect(res.body.data.flags).toBe(64);
    expect(JSON.stringify(res.body.data.embeds)).toContain("#alerts");
    expect(res.body.data.components[0].components[0].custom_id).toBe("status:refresh");
  });

  it("replies publicly when the rule says so, and refresh updates in place", async () => {
    const guild = await createGuild();
    await setRule(guild.id, "status", true, { visibility: "public" });
    const res = await call(command("status", {}, { guildId: guild.id }));
    expect(res.body.data.flags).toBe(0);

    const refresh = await call(button("status:refresh", { guildId: guild.id }));
    expect(refresh.body.type).toBe(7);
    expect(refresh.body.data.flags).toBeUndefined();
  });
});

describe("report buttons", () => {
  async function fileOne(overrides = {}) {
    const guild = await createGuild({
      alertChannelId: "700000000000000001",
      mirrorKind: "slack",
      mirrorUrlEncrypted: "x",
      ...overrides,
    });
    await setRule(guild.id, "report", true, { aiTriage: false });
    await call(command("report", { details: "button test" }, { guildId: guild.id }));
    const [report] = await db().select().from(reports);
    return { guild, report };
  }

  it("requires Manage Messages", async () => {
    const { guild, report } = await fileOne();
    const res = await call(button(`report:ack:${report.id}`, { guildId: guild.id }));
    expect(res.body.data.content).toMatch(/Manage Messages/);
    const [after] = await db().select().from(reports);
    expect(after.status).toBe("open");
  });

  it("acknowledges, updates the message in place and mirrors once", async () => {
    const { guild, report } = await fileOne();
    const click = () =>
      call(button(`report:ack:${report.id}`, { guildId: guild.id, permissions: MANAGE_MESSAGES }));
    const [a, b] = await Promise.all([click(), click()]);

    expect(a.body.type).toBe(7);
    expect(b.body.type).toBe(7);
    const [after] = await db().select().from(reports);
    expect(after.status).toBe("acknowledged");
    const mirrors = await db().select().from(jobs).where(eq(jobs.kind, "mirror"));
    // One from filing the report, one from the single winning status change.
    expect(mirrors).toHaveLength(2);
  });

  it("cannot touch a report that belongs to another server", async () => {
    const { report } = await fileOne();
    const other = await createGuild();
    const res = await call(
      button(`report:resolve:${report.id}`, { guildId: other.id, permissions: MANAGE_MESSAGES }),
    );
    expect(res.body.data.content).toMatch(/can't find/);
    const [after] = await db().select().from(reports);
    expect(after.status).toBe("open");
  });
});

describe("failure handling", () => {
  it("returns 500 without leaving partial state when the database write fails", async () => {
    const guild = await createGuild();
    const spy = vi.spyOn(db(), "transaction").mockRejectedValueOnce(new Error("connection reset"));
    const res = await call(command("report", { details: "x" }, { guildId: guild.id }));
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "internal_error" });
    expect(await countOf(interactions)).toBe(0);
  });
});
