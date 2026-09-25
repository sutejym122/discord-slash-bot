import type { Metadata } from "next";
import { Notice, Pill, Section } from "@/components/ui";
import { env } from "@/server/env";
import { listGuildAdmins, postableChannels } from "@/server/guilds/settings";
import { JobError } from "@/server/jobs/errors";
import { loadGuild } from "../guild";
import { AccessList, ChannelPicker, DisconnectButton, MirrorForm, OutageTool } from "./forms";

export const metadata: Metadata = { title: "Settings" };

async function loadChannels(guildId: string) {
  try {
    return { channels: await postableChannels(guildId), error: null };
  } catch (error) {
    const code = error instanceof JobError ? error.code : "unexpected";
    return { channels: [], error: code };
  }
}

export default async function SettingsPage({
  params,
  searchParams,
}: PageProps<"/dashboard/[guildId]/settings">) {
  const { guildId } = await params;
  const { connected } = await searchParams;
  const { guild, role, user } = await loadGuild(guildId);
  const [{ channels, error }, admins] = await Promise.all([
    loadChannels(guild.id),
    listGuildAdmins(guild.id),
  ]);
  const isOwner = role === "owner";
  const aiConfigured = Boolean(env().GROQ_API_KEY);

  return (
    <div className="enter">
      {connected && (
        <div className="mb-8">
          <Notice tone="ok">
            Connected. Pick an alert channel and a mirror below, then try /report in Discord.
          </Notice>
        </div>
      )}

      <Section
        title="Alert channel"
        description="Where new reports are posted for moderators, with buttons to acknowledge and resolve them."
      >
        {error ? (
          <Notice tone="bad">
            {error === "bot_not_in_guild"
              ? "The bot isn't in this server anymore, so its channels can't be listed. Reconnect it from the Servers page."
              : error === "bot_token_invalid"
                ? "Discord rejected the bot token configured on the server, so channels can't be listed."
                : "Couldn't load channels from Discord right now. Refresh to try again."}
          </Notice>
        ) : (
          <ChannelPicker guildId={guild.id} channels={channels} current={guild.alertChannelId} />
        )}
      </Section>

      <Section
        title="Mirror"
        description="A second place every report is copied to. Useful for a team channel in Slack, or a private log channel in Discord."
      >
        <MirrorForm guildId={guild.id} kind={guild.mirrorKind} hint={guild.mirrorUrlHint} />
      </Section>

      <Section
        title="AI triage"
        description="Summarises each report, suggests a category, severity, tags and a next step. Turn it on or off per server under Rules."
      >
        <div className="flex items-center gap-3 text-sm">
          {aiConfigured ? (
            <Pill tone="ok">Available</Pill>
          ) : (
            <Pill tone="neutral">Not configured</Pill>
          )}
          <span className="text-ink-2">
            {aiConfigured
              ? `Groq, ${env().GROQ_MODEL}`
              : "Set GROQ_API_KEY on the server to enable it. Reports still work without it."}
          </span>
        </div>
      </Section>

      <Section
        title="Testing tools"
        description="Makes mirror deliveries fail with a 503 for a few minutes, so you can watch retries back off and recover in Activity. Nothing is sent while it's active."
      >
        <OutageTool
          guildId={guild.id}
          until={guild.mirrorOutageUntil?.toISOString() ?? null}
          hasMirror={Boolean(guild.mirrorKind)}
        />
      </Section>

      <Section
        title="Dashboard access"
        description="People who can see this server's activity and change its settings. Only the owner, who connected the server, can add or remove people."
      >
        <AccessList
          guildId={guild.id}
          currentUserId={user.id}
          canManage={isOwner}
          admins={admins.map((a) => ({ ...a, addedAt: a.addedAt.toISOString() }))}
        />
      </Section>

      <Section title="Disconnect" description="Removes the bot from this server.">
        {isOwner ? (
          <DisconnectButton guildId={guild.id} guildName={guild.name} />
        ) : (
          <p className="text-sm text-ink-2">Only the server's owner can disconnect it.</p>
        )}
      </Section>
    </div>
  );
}
