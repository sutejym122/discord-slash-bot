import "server-only";
import { env } from "../env";
import { send } from "../http";

export const DISCORD_API = "https://discord.com/api/v10";

function botHeaders() {
  return {
    Authorization: `Bot ${env().DISCORD_BOT_TOKEN}`,
    "Content-Type": "application/json",
  };
}

// Edits the message sent as the interaction's initial response. Uses the interaction token,
// not the bot token. Discord answers 404 "Unknown Webhook" once the token has expired.
export async function editOriginalResponse(token: string, body: unknown) {
  await send(
    "discord",
    `${DISCORD_API}/webhooks/${env().DISCORD_APPLICATION_ID}/${token}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { permanentCodes: { 401: "interaction_token_expired", 404: "interaction_token_expired" } },
  );
}

// `nonce` + `enforce_nonce` makes Discord drop a second create with the same nonce for a few
// minutes, which covers a retry after a crash between sending and recording success.
export async function createChannelMessage(channelId: string, body: object, nonce: string) {
  const res = await send(
    "discord",
    `${DISCORD_API}/channels/${channelId}/messages`,
    {
      method: "POST",
      headers: botHeaders(),
      body: JSON.stringify({ ...body, nonce, enforce_nonce: true }),
    },
    { permanentCodes: { 403: "missing_channel_access", 404: "channel_not_found" } },
  );
  return (await res.json()) as { id: string; channel_id: string };
}

export type GuildChannel = {
  id: string;
  name: string;
  type: number;
  position: number;
  parent_id: string | null;
};

export async function listGuildChannels(guildId: string): Promise<GuildChannel[]> {
  const res = await send(
    "discord",
    `${DISCORD_API}/guilds/${guildId}/channels`,
    { headers: botHeaders() },
    { permanentCodes: { 403: "bot_not_in_guild", 404: "bot_not_in_guild" } },
  );
  return (await res.json()) as GuildChannel[];
}

export async function getGuild(guildId: string) {
  const res = await send(
    "discord",
    `${DISCORD_API}/guilds/${guildId}`,
    { headers: botHeaders() },
    { permanentCodes: { 403: "bot_not_in_guild", 404: "bot_not_in_guild" } },
  );
  return (await res.json()) as { id: string; name: string; icon: string | null };
}

export async function leaveGuild(guildId: string) {
  await send(
    "discord",
    `${DISCORD_API}/users/@me/guilds/${guildId}`,
    { method: "DELETE", headers: botHeaders() },
    { permanentCodes: { 404: "bot_not_in_guild" } },
  );
}

export async function overwriteGlobalCommands(commands: unknown) {
  const res = await send(
    "discord",
    `${DISCORD_API}/applications/${env().DISCORD_APPLICATION_ID}/commands`,
    {
      method: "PUT",
      headers: botHeaders(),
      body: JSON.stringify(commands),
    },
  );
  return (await res.json()) as { name: string }[];
}

export async function exchangeInstallCode(code: string, redirectUri: string) {
  const res = await send(
    "discord",
    `${DISCORD_API}/oauth2/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: env().DISCORD_APPLICATION_ID,
        client_secret: env().DISCORD_CLIENT_SECRET,
      }),
    },
    { permanentCodes: { 400: "invalid_install_code", 401: "invalid_client" } },
  );
  return (await res.json()) as {
    guild?: { id: string; name: string; icon: string | null };
    scope: string;
  };
}
