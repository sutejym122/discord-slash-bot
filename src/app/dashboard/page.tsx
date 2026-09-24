import type { Metadata } from "next";
import Link from "next/link";
import { GuildIcon } from "@/components/guild-icon";
import { ButtonLink, EmptyState, Notice, Pill } from "@/components/ui";
import { listGuildsFor } from "@/server/guilds/access";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Servers" };

const INSTALL_NOTICES: Record<string, { tone: "warn" | "bad"; text: string }> = {
  cancelled: { tone: "warn", text: "The install was cancelled in Discord. Nothing was connected." },
  expired: {
    tone: "warn",
    text: "That install link expired or was opened in another browser. Start again from here.",
  },
  failed: {
    tone: "bad",
    text: "Discord accepted the install, but it couldn't be confirmed here. Try connecting again.",
  },
};

export default async function ServersPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser();
  const guilds = await listGuildsFor(user.id);
  const { install } = await searchParams;
  const notice = typeof install === "string" ? INSTALL_NOTICES[install] : undefined;

  return (
    <main className="mx-auto max-w-6xl px-5 py-12 sm:px-8 enter">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Servers</h1>
          <p className="mt-1.5 text-sm text-ink-2">Discord servers you manage with Slash Bot.</p>
        </div>
        {guilds.length > 0 && (
          <ButtonLink href="/api/discord/install" prefetch={false} variant="primary">
            Connect a server
          </ButtonLink>
        )}
      </div>

      {notice && (
        <div className="mt-8">
          <Notice tone={notice.tone}>{notice.text}</Notice>
        </div>
      )}

      <div className="mt-10">
        {guilds.length === 0 ? (
          <EmptyState
            title="No servers connected yet"
            action={
              <ButtonLink href="/api/discord/install" prefetch={false} variant="primary">
                Connect a server
              </ButtonLink>
            }
          >
            Connecting adds the bot to a Discord server you manage. After that you pick where alerts
            go and where notifications are mirrored.
          </EmptyState>
        ) : (
          <ul className="grid gap-px overflow-hidden rounded-xl border border-line bg-line">
            {guilds.map((g) => {
              const ready = Boolean(g.alertChannelId && g.mirrorKind);
              return (
                <li key={g.id}>
                  <Link
                    href={`/dashboard/${g.id}`}
                    className="flex items-center gap-4 bg-surface px-5 py-4 transition-colors hover:bg-surface-2"
                  >
                    <GuildIcon guild={g} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{g.name}</p>
                      <p className="mt-0.5 truncate text-sm text-ink-3">
                        {g.alertChannelName
                          ? `Alerts in #${g.alertChannelName}`
                          : "No alert channel"}
                        {" · "}
                        {g.mirrorKind
                          ? `Mirrors to ${g.mirrorKind === "slack" ? "Slack" : "Discord"}`
                          : "No mirror"}
                      </p>
                    </div>
                    {ready ? <Pill tone="ok">Ready</Pill> : <Pill tone="warn">Setup needed</Pill>}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
