import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { guildAdmins, guilds } from "../db/schema";
import { exchangeInstallCode } from "../discord/rest";
import { Permission } from "../discord/types";
import { env } from "../env";

export const INSTALL_STATE_COOKIE = "install_state";

const BOT_PERMISSIONS = Permission.ViewChannel | Permission.SendMessages | Permission.EmbedLinks;

export function redirectUri() {
  return `${env().APP_URL}/api/discord/callback`;
}

export function newInstallState() {
  return randomBytes(24).toString("base64url");
}

export function installUrl(state: string) {
  const params = new URLSearchParams({
    client_id: env().DISCORD_APPLICATION_ID,
    scope: "bot applications.commands",
    permissions: BOT_PERMISSIONS.toString(),
    integration_type: "0",
    response_type: "code",
    redirect_uri: redirectUri(),
    state,
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

export function statesMatch(expected: string | undefined, given: string | null) {
  if (!expected || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Completes a bot install. The guild comes from Discord's token response, not from the
 * callback's query string, so it can't be forged. Discord only lets someone add a bot to a
 * server where they have Manage Server, which is what makes them an admin here.
 */
export async function completeInstall(userId: string, code: string) {
  const token = await exchangeInstallCode(code, redirectUri());
  if (!token.guild) throw new Error("Discord did not return a server for this install");
  const { id, name, icon } = token.guild;

  await db().transaction(async (tx) => {
    await tx
      .insert(guilds)
      .values({ id, name, icon })
      .onConflictDoUpdate({
        target: guilds.id,
        set: { name, icon, disconnectedAt: null, updatedAt: sql`now()` },
      });
    await tx.insert(guildAdmins).values({ guildId: id, userId }).onConflictDoNothing();
  });
  return id;
}
