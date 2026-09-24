"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import type { CommandName } from "@/server/discord/commands";
import { leaveGuild } from "@/server/discord/rest";
import { GuildAccessError, requireGuildAdmin } from "@/server/guilds/access";
import {
  type ActionResult,
  clearMirror,
  disconnectGuild,
  retryJob,
  saveRule,
  sendTestMirror,
  setAlertChannel,
  setMirror,
  setMirrorOutage,
} from "@/server/guilds/settings";
import { JobError } from "@/server/jobs/errors";
import { drainJobs } from "@/server/jobs/runner";
import { log } from "@/server/log";
import { requireUser } from "@/server/session";

// Every action re-checks the session and guild access itself. Server actions are public POST
// endpoints, so the page having done the check is not enough.
async function asAdmin(guildId: string) {
  const user = await requireUser();
  return { user, guild: await requireGuildAdmin(user.id, guildId) };
}

async function run(
  guildId: string,
  fn: (ctx: Awaited<ReturnType<typeof asAdmin>>) => Promise<ActionResult>,
): Promise<ActionResult> {
  try {
    const result = await fn(await asAdmin(guildId));
    if (result.ok) revalidatePath(`/dashboard/${guildId}`, "layout");
    return result;
  } catch (error) {
    if (error instanceof GuildAccessError) return { ok: false, error: "Server not found." };
    if (error instanceof JobError) return { ok: false, error: `Discord: ${error.message}` };
    // redirect() from requireUser throws a special error that must propagate.
    if (error instanceof Error && "digest" in error) throw error;
    log.error("dashboard.action_failed", { guildId, error });
    return { ok: false, error: "Something failed on our side. Try again." };
  }
}

export async function saveAlertChannelAction(guildId: string, channelId: string | null) {
  return run(guildId, () => setAlertChannel(guildId, channelId));
}

export async function saveMirrorAction(guildId: string, url: string) {
  return run(guildId, () => setMirror(guildId, url));
}

export async function removeMirrorAction(guildId: string) {
  return run(guildId, () => clearMirror(guildId));
}

export async function testMirrorAction(guildId: string) {
  return run(guildId, ({ guild }) => sendTestMirror(guild));
}

export async function simulateOutageAction(guildId: string, minutes: number | null) {
  return run(guildId, () =>
    setMirrorOutage(guildId, minutes === null ? null : Math.min(minutes, 30)),
  );
}

export async function saveRuleAction(
  guildId: string,
  command: CommandName,
  enabled: boolean,
  settings: unknown,
): Promise<ActionResult & { fieldErrors?: Record<string, string> }> {
  if (command !== "report" && command !== "status") return { ok: false, error: "Unknown command." };
  let fieldErrors: Record<string, string> | undefined;
  const result = await run(guildId, async ({ user }) => {
    const saved = await saveRule(guildId, user.id, command, { enabled, settings });
    fieldErrors = "fieldErrors" in saved ? saved.fieldErrors : undefined;
    return saved;
  });
  return { ...result, fieldErrors };
}

export async function retryJobAction(guildId: string, jobId: string) {
  return run(guildId, async () => {
    const result = await retryJob(guildId, jobId);
    if (result.ok) after(() => drainJobs({ budgetMs: 20_000 }).then(() => {}));
    return result;
  });
}

export async function disconnectAction(guildId: string) {
  return run(guildId, async () => {
    const result = await disconnectGuild(guildId);
    // Best effort: the server is disconnected here either way.
    await leaveGuild(guildId).catch((error) => log.warn("guild.leave_failed", { guildId, error }));
    return result;
  });
}
