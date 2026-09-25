import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { decrypt, encrypt } from "../crypto";
import { db } from "../db/client";
import { commandRules, type Guild, guildAdmins, guilds, jobs, users } from "../db/schema";
import type { CommandName } from "../discord/commands";
import { listGuildChannels } from "../discord/rest";
import { JobError } from "../jobs/errors";
import { deliverMirror, detectMirrorKind, mirrorHint } from "../mirror";
import { settingsSchemas } from "./rules";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

// Text and announcement channels are the ones a bot can post an embed into.
const POSTABLE_CHANNEL_TYPES = new Set([0, 5]);

export async function postableChannels(guildId: string) {
  const channels = await listGuildChannels(guildId);
  const categories = new Map(channels.filter((c) => c.type === 4).map((c) => [c.id, c.name]));
  return channels
    .filter((c) => POSTABLE_CHANNEL_TYPES.has(c.type))
    .sort((a, b) => a.position - b.position)
    .map((c) => ({
      id: c.id,
      name: c.name,
      category: c.parent_id ? (categories.get(c.parent_id) ?? null) : null,
    }));
}

export async function setAlertChannel(
  guildId: string,
  channelId: string | null,
): Promise<ActionResult> {
  if (channelId === null) {
    await db()
      .update(guilds)
      .set({ alertChannelId: null, alertChannelName: null })
      .where(eq(guilds.id, guildId));
    return { ok: true, message: "Alert channel removed" };
  }
  // The channel must come from this server's own channel list, fetched fresh from Discord,
  // so a crafted form can't point the bot at another server's channel.
  const channel = (await postableChannels(guildId)).find((c) => c.id === channelId);
  if (!channel) return { ok: false, error: "That channel isn't a text channel in this server." };
  await db()
    .update(guilds)
    .set({ alertChannelId: channel.id, alertChannelName: channel.name })
    .where(eq(guilds.id, guildId));
  return { ok: true, message: `Alerts will go to #${channel.name}` };
}

export async function setMirror(guildId: string, url: string): Promise<ActionResult> {
  const trimmed = url.trim();
  const kind = detectMirrorKind(trimmed);
  if (!kind) {
    return {
      ok: false,
      error:
        "Paste a Slack incoming webhook (hooks.slack.com/services/...) or a Discord webhook URL (discord.com/api/webhooks/...).",
    };
  }
  await db()
    .update(guilds)
    .set({
      mirrorKind: kind,
      mirrorUrlEncrypted: encrypt(trimmed),
      mirrorUrlHint: mirrorHint(kind, trimmed),
    })
    .where(eq(guilds.id, guildId));
  return { ok: true, message: `${kind === "slack" ? "Slack" : "Discord"} webhook saved` };
}

export async function clearMirror(guildId: string): Promise<ActionResult> {
  await db()
    .update(guilds)
    .set({
      mirrorKind: null,
      mirrorUrlEncrypted: null,
      mirrorUrlHint: null,
      mirrorOutageUntil: null,
    })
    .where(eq(guilds.id, guildId));
  return { ok: true, message: "Mirror removed" };
}

export async function sendTestMirror(guild: Guild): Promise<ActionResult> {
  if (!guild.mirrorKind || !guild.mirrorUrlEncrypted)
    return { ok: false, error: "No mirror is set up yet." };
  try {
    await deliverMirror(
      guild.mirrorKind,
      decrypt(guild.mirrorUrlEncrypted),
      `${guild.name}: test message from Slash Bot. Reports will be mirrored here.`,
    );
    return { ok: true, message: "Test message delivered" };
  } catch (error) {
    const reason = error instanceof JobError ? error.message : "Unexpected error";
    return { ok: false, error: `Delivery failed: ${reason}` };
  }
}

export async function setMirrorOutage(
  guildId: string,
  minutes: number | null,
): Promise<ActionResult> {
  await db()
    .update(guilds)
    .set({ mirrorOutageUntil: minutes ? new Date(Date.now() + minutes * 60_000) : null })
    .where(eq(guilds.id, guildId));
  return {
    ok: true,
    message: minutes
      ? `Mirror will fail for the next ${minutes} minutes`
      : "Simulated outage ended",
  };
}

export async function saveRule(
  guildId: string,
  userId: string,
  command: CommandName,
  input: { enabled: boolean; settings: unknown },
): Promise<ActionResult & { fieldErrors?: Record<string, string> }> {
  const schema = settingsSchemas[command];
  const parsed = schema.safeParse(input.settings);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] = issue.message;
    return { ok: false, error: "Some settings need fixing.", fieldErrors };
  }
  await db()
    .insert(commandRules)
    .values({ guildId, command, enabled: input.enabled, settings: parsed.data, updatedBy: userId })
    .onConflictDoUpdate({
      target: [commandRules.guildId, commandRules.command],
      set: {
        enabled: input.enabled,
        settings: parsed.data,
        updatedBy: userId,
        updatedAt: sql`now()`,
      },
    });
  return { ok: true, message: `/${command} rules saved` };
}

const MANUAL_RETRY_ATTEMPTS = 3;

// Manual retry from the dashboard: gives a failed job a fresh set of attempts. Scoped to the
// guild so one admin can't requeue another server's work.
export async function retryJob(guildId: string, jobId: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(jobId).success) return { ok: false, error: "Unknown job." };
  const [job] = await db()
    .update(jobs)
    .set({
      status: "pending",
      runAt: new Date(),
      finishedAt: null,
      lockedUntil: null,
      maxAttempts: sql`${jobs.attempts} + ${MANUAL_RETRY_ATTEMPTS}`,
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.guildId, guildId), eq(jobs.status, "failed")))
    .returning({ id: jobs.id, kind: jobs.kind });
  if (!job) return { ok: false, error: "That job isn't in a failed state anymore." };
  return { ok: true, message: `Retrying ${job.kind.replace("_", " ")}` };
}

export async function disconnectGuild(guildId: string): Promise<ActionResult> {
  await db().update(guilds).set({ disconnectedAt: new Date() }).where(eq(guilds.id, guildId));
  return { ok: true, message: "Server disconnected" };
}

export async function listGuildAdmins(guildId: string) {
  return db()
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      role: guildAdmins.role,
      addedAt: guildAdmins.createdAt,
    })
    .from(guildAdmins)
    .innerJoin(users, eq(users.id, guildAdmins.userId))
    .where(eq(guildAdmins.guildId, guildId))
    .orderBy(asc(guildAdmins.createdAt));
}

// Shares a server's dashboard with an existing account. Accounts are only created by the
// operator (there's no sign-up), so an unknown email is an error rather than an invite.
export async function shareAccess(guildId: string, email: string): Promise<ActionResult> {
  const parsed = z.email().safeParse(email.trim().toLowerCase());
  if (!parsed.success) return { ok: false, error: "Enter an email address." };
  const user = await db().query.users.findFirst({ where: eq(users.email, parsed.data) });
  if (!user) return { ok: false, error: "There's no account with that email." };
  const added = await db()
    .insert(guildAdmins)
    .values({ guildId, userId: user.id, role: "admin" })
    .onConflictDoNothing()
    .returning({ userId: guildAdmins.userId });
  if (added.length === 0) return { ok: false, error: `${parsed.data} already has access.` };
  return { ok: true, message: `${parsed.data} can now manage this server` };
}

export async function revokeAccess(guildId: string, userId: string): Promise<ActionResult> {
  const removed = await db()
    .delete(guildAdmins)
    .where(
      and(
        eq(guildAdmins.guildId, guildId),
        eq(guildAdmins.userId, userId),
        eq(guildAdmins.role, "admin"),
      ),
    )
    .returning({ userId: guildAdmins.userId });
  if (removed.length === 0) return { ok: false, error: "That person can't be removed." };
  return { ok: true, message: "Access removed" };
}
