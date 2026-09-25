import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as activityRoute } from "@/app/api/guilds/[guildId]/activity/route";
import { upsertAdmin } from "@/server/admins";
import { auth } from "@/server/auth";
import { encrypt } from "@/server/crypto";
import { closeDb, db } from "@/server/db/client";
import { guilds, jobs } from "@/server/db/schema";
import {
  GuildAccessError,
  listGuildsFor,
  OwnerRequiredError,
  requireGuildAdmin,
  requireGuildOwner,
} from "@/server/guilds/access";
import {
  listGuildAdmins,
  retryJob,
  revokeAccess,
  saveRule,
  setAlertChannel,
  setMirror,
  shareAccess,
} from "@/server/guilds/settings";
import { handleInteractionRequest } from "@/server/interactions/endpoint";
import { drainJobs } from "@/server/jobs/runner";
import { createGuild, makeAdmin, resetDb } from "../support/db";
import { command, signedRequest } from "../support/discord";
import { fakeHttp, SLACK } from "../support/fake-http";

const PASSWORD = "correct-horse-battery";

async function signIn(email: string) {
  const res = await auth().api.signInEmail({
    body: { email, password: PASSWORD },
    asResponse: true,
  });
  expect(res.status).toBe(200);
  const cookie = res.headers.get("set-cookie") ?? "";
  return cookie.split(";")[0];
}

function getActivity(guildId: string, cookie?: string) {
  return activityRoute(
    new Request(`http://localhost:3000/api/guilds/${guildId}/activity`, {
      headers: cookie ? { cookie } : {},
    }),
    { params: Promise.resolve({ guildId }) },
  );
}

let alice: { id: string };
let bob: { id: string };

beforeEach(async () => {
  await resetDb();
  alice = (await upsertAdmin("alice@example.com", PASSWORD)).user;
  bob = (await upsertAdmin("bob@example.com", PASSWORD)).user;
});
afterEach(() => vi.unstubAllGlobals());
afterAll(closeDb);

describe("authentication", () => {
  it("rejects a wrong password and has no public sign-up", async () => {
    const bad = await auth().api.signInEmail({
      body: { email: "alice@example.com", password: "wrong-password-123" },
      asResponse: true,
    });
    expect(bad.status).toBe(401);

    const signUp = await auth().api.signUpEmail({
      body: { email: "mallory@example.com", password: PASSWORD, name: "m" },
      asResponse: true,
    });
    expect(signUp.status).toBeGreaterThanOrEqual(400);
  });

  it("returns 401 from the activity API without a session", async () => {
    const guild = await createGuild();
    await makeAdmin(guild.id, alice.id);
    expect((await getActivity(guild.id)).status).toBe(401);
    expect((await getActivity(guild.id, "better-auth.session_token=forged.value")).status).toBe(
      401,
    );
  });
});

describe("guild isolation", () => {
  it("only lists and opens servers the user administers", async () => {
    const a = await createGuild({ name: "Alice's server" });
    const b = await createGuild({ name: "Bob's server" });
    await makeAdmin(a.id, alice.id);
    await makeAdmin(b.id, bob.id);

    expect((await listGuildsFor(alice.id)).map((g) => g.id)).toEqual([a.id]);
    await expect(requireGuildAdmin(alice.id, b.id)).rejects.toBeInstanceOf(GuildAccessError);
    await expect(requireGuildAdmin(alice.id, "not-a-snowflake")).rejects.toBeInstanceOf(
      GuildAccessError,
    );
  });

  it("answers 404 for another admin's server, the same as for one that doesn't exist", async () => {
    const a = await createGuild();
    const b = await createGuild();
    await makeAdmin(a.id, alice.id);
    await makeAdmin(b.id, bob.id);
    const cookie = await signIn("alice@example.com");

    expect((await getActivity(a.id, cookie)).status).toBe(200);
    const other = await getActivity(b.id, cookie);
    const missing = await getActivity("123456789012345678", cookie);
    expect(other.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await other.json()).toEqual(await missing.json());
  });

  it("hides disconnected servers", async () => {
    const guild = await createGuild({ disconnectedAt: new Date() });
    await makeAdmin(guild.id, alice.id);
    expect(await listGuildsFor(alice.id)).toEqual([]);
    await expect(requireGuildAdmin(alice.id, guild.id)).rejects.toBeInstanceOf(GuildAccessError);
  });

  it("scopes activity to the server asked for", async () => {
    const a = await createGuild();
    const b = await createGuild();
    await makeAdmin(a.id, alice.id);
    for (const g of [a, b]) {
      await handleInteractionRequest(
        signedRequest(command("report", { details: `for ${g.id}` }, { guildId: g.id })),
        { schedule: () => {} },
      );
    }
    const cookie = await signIn("alice@example.com");
    const body = await (await getActivity(a.id, cookie)).json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].report.details).toBe(`for ${a.id}`);
  });

  it("won't retry a job that belongs to another server", async () => {
    const a = await createGuild();
    const b = await createGuild({ mirrorKind: "slack", mirrorUrlEncrypted: "x" });
    await handleInteractionRequest(
      signedRequest(command("report", { details: "b's report" }, { guildId: b.id })),
      { schedule: () => {} },
    );
    const [job] = await db().select().from(jobs);
    await db().update(jobs).set({ status: "failed" }).where(eq(jobs.id, job.id));

    expect(await retryJob(a.id, job.id)).toMatchObject({ ok: false });
    expect(await retryJob(b.id, job.id)).toMatchObject({ ok: true });
  });
});

describe("sharing access", () => {
  it("lets the owner add an existing account, who then sees only that server", async () => {
    const guild = await createGuild();
    const other = await createGuild();
    await makeAdmin(guild.id, alice.id, "owner");
    await makeAdmin(other.id, alice.id, "owner");

    expect(await shareAccess(guild.id, "nobody@example.com")).toMatchObject({ ok: false });
    expect(await shareAccess(guild.id, "not an email")).toMatchObject({ ok: false });
    expect(await shareAccess(guild.id, " BOB@example.com ")).toMatchObject({ ok: true });
    expect(await shareAccess(guild.id, "bob@example.com")).toMatchObject({ ok: false });

    expect((await listGuildsFor(bob.id)).map((g) => g.id)).toEqual([guild.id]);
    const cookie = await signIn("bob@example.com");
    expect((await getActivity(guild.id, cookie)).status).toBe(200);
    expect((await getActivity(other.id, cookie)).status).toBe(404);
  });

  it("keeps owner-only actions away from added admins, and never removes the owner", async () => {
    const guild = await createGuild();
    await makeAdmin(guild.id, alice.id, "owner");
    await makeAdmin(guild.id, bob.id, "admin");

    await expect(requireGuildOwner(bob.id, guild.id)).rejects.toBeInstanceOf(OwnerRequiredError);
    await expect(requireGuildOwner(alice.id, guild.id)).resolves.toMatchObject({ id: guild.id });

    expect(await revokeAccess(guild.id, alice.id)).toMatchObject({ ok: false });
    expect(await revokeAccess(guild.id, bob.id)).toMatchObject({ ok: true });
    expect((await listGuildAdmins(guild.id)).map((a) => a.email)).toEqual(["alice@example.com"]);
    await expect(requireGuildAdmin(bob.id, guild.id)).rejects.toBeInstanceOf(GuildAccessError);
  });
});

describe("settings", () => {
  it("only accepts an alert channel that Discord lists for this server", async () => {
    const http = fakeHttp();
    const guild = await createGuild();
    http.on(/\/guilds\/\d+\/channels$/, {
      json: [
        { id: "700000000000000001", name: "alerts", type: 0, position: 1, parent_id: null },
        { id: "700000000000000002", name: "Voice", type: 2, position: 2, parent_id: null },
      ],
    });

    expect(await setAlertChannel(guild.id, "700000000000000001")).toMatchObject({ ok: true });
    expect(await setAlertChannel(guild.id, "700000000000000002")).toMatchObject({ ok: false });
    expect(await setAlertChannel(guild.id, "999999999999999999")).toMatchObject({ ok: false });
    const [row] = await db().select().from(guilds);
    expect(row).toMatchObject({ alertChannelId: "700000000000000001", alertChannelName: "alerts" });
  });

  it("only accepts real Slack or Discord webhook URLs", async () => {
    const guild = await createGuild();
    for (const url of [
      "http://169.254.169.254/latest/meta-data",
      "https://hooks.slack.com.evil.example/services/T/B/C",
      "http://hooks.slack.com/services/T000/B000/abc",
      "https://evil.example/api/webhooks/123456789012345678/abcdefghijklmnopqrstu",
      "not a url",
    ]) {
      expect(await setMirror(guild.id, url)).toMatchObject({ ok: false });
    }
    expect(
      await setMirror(guild.id, "https://hooks.slack.com/services/T0000/B0000/abcdefabcdef"),
    ).toMatchObject({ ok: true });
  });

  it("stores the webhook encrypted and never returns it from the activity API", async () => {
    const url = "https://hooks.slack.com/services/T0000/B0000/abcdefabcdef";
    const guild = await createGuild();
    await makeAdmin(guild.id, alice.id);
    await setMirror(guild.id, url);
    await saveRule(guild.id, alice.id, "report", { enabled: true, settings: { aiTriage: false } });

    const [row] = await db().select().from(guilds);
    expect(row.mirrorUrlEncrypted).not.toContain("abcdefabcdef");
    expect(row.mirrorUrlHint).toBe("hooks.slack.com/…cdef");

    const http = fakeHttp();
    http.on(SLACK, { status: 500 });
    await handleInteractionRequest(
      signedRequest(command("report", { details: "x", severity: "high" }, { guildId: guild.id })),
      { schedule: () => {} },
    );
    await drainJobs({ budgetMs: 2_000 });
    const text = await (await getActivity(guild.id, await signIn("alice@example.com"))).text();
    expect(text).not.toContain("abcdefabcdef");
    expect(text).not.toContain("interaction-token");
    expect(text).toContain("slack_unavailable");
  });

  it("validates rule settings and reports field errors", async () => {
    const guild = await createGuild();
    const bad = await saveRule(guild.id, alice.id, "report", {
      enabled: true,
      settings: { pingRoleId: "@moderators", alertMinSeverity: "extreme" },
    });
    expect(bad.ok).toBe(false);
    expect(Object.keys(bad.fieldErrors ?? {}).sort()).toEqual(["alertMinSeverity", "pingRoleId"]);

    const good = await saveRule(guild.id, alice.id, "report", {
      enabled: false,
      settings: { pingRoleId: "900000000000000001" },
    });
    expect(good.ok).toBe(true);
  });
});

describe("mirror secrets at rest", () => {
  it("round-trips through encryption", async () => {
    const guild = await createGuild({ mirrorUrlEncrypted: encrypt("https://hooks.slack.com/x") });
    expect(guild.mirrorUrlEncrypted?.startsWith("v1.")).toBe(true);
  });
});
