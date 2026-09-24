import Link from "next/link";
import { GuildIcon } from "@/components/guild-icon";
import { loadGuild } from "./guild";
import { Tabs } from "./tabs";

export default async function GuildLayout({
  children,
  params,
}: LayoutProps<"/dashboard/[guildId]">) {
  const { guildId } = await params;
  const { guild } = await loadGuild(guildId);

  return (
    <>
      <div className="border-b border-line">
        <div className="mx-auto max-w-6xl px-5 pt-8 sm:px-8">
          <Link href="/dashboard" className="text-sm text-ink-3 transition-colors hover:text-ink">
            Servers
          </Link>
          <div className="mt-3 mb-7 flex items-center gap-4">
            <GuildIcon guild={guild} size={44} />
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{guild.name}</h1>
              <p className="mt-0.5 font-mono text-xs text-ink-3">{guild.id}</p>
            </div>
          </div>
          <Tabs guildId={guild.id} />
        </div>
      </div>
      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8">{children}</main>
    </>
  );
}
