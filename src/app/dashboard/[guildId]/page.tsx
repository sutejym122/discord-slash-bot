import type { Metadata } from "next";
import Link from "next/link";
import { deliveryHealth, getActivity } from "@/server/guilds/activity";
import { ActivityLog } from "./activity-log";
import { loadGuild } from "./guild";

export const metadata: Metadata = { title: "Activity" };

function SetupSteps({
  guildId,
  steps,
}: {
  guildId: string;
  steps: { done: boolean; label: string; href?: string }[];
}) {
  return (
    <div className="mb-10 rounded-xl border border-line bg-surface px-6 py-5">
      <p className="font-medium">Finish setting up</p>
      <ol className="mt-3 grid gap-2">
        {steps.map((s, i) => (
          <li key={s.label} className="flex items-center gap-3 text-sm">
            <span
              className={
                s.done
                  ? "grid size-5 place-items-center rounded-full bg-ok text-[11px] text-white"
                  : "grid size-5 place-items-center rounded-full border border-line-strong text-[11px] text-ink-3"
              }
            >
              {s.done ? "✓" : i + 1}
            </span>
            {s.done || !s.href ? (
              <span className={s.done ? "text-ink-3 line-through" : ""}>{s.label}</span>
            ) : (
              <Link
                href={`/dashboard/${guildId}${s.href}`}
                className="underline underline-offset-4"
              >
                {s.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export default async function ActivityPage({ params }: PageProps<"/dashboard/[guildId]">) {
  const { guildId } = await params;
  const { guild } = await loadGuild(guildId);
  const [activity, health] = await Promise.all([getActivity(guild.id), deliveryHealth(guild.id)]);

  const steps = [
    { done: true, label: "Add the bot to the server" },
    { done: Boolean(guild.alertChannelId), label: "Pick an alert channel", href: "/settings" },
    { done: Boolean(guild.mirrorKind), label: "Add a mirror webhook", href: "/settings" },
    { done: activity.items.length > 0, label: "Run /report in Discord" },
  ];

  return (
    <div className="enter">
      {steps.some((s) => !s.done) && <SetupSteps guildId={guild.id} steps={steps} />}
      <ActivityLog guildId={guild.id} guildName={guild.name} initial={{ ...activity, health }} />
    </div>
  );
}
