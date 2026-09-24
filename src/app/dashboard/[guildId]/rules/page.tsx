import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { db } from "@/server/db/client";
import { commandRules } from "@/server/db/schema";
import { env } from "@/server/env";
import { parseRule } from "@/server/guilds/rules";
import { loadGuild } from "../guild";
import { ReportRuleForm, StatusRuleForm } from "./rule-forms";

export const metadata: Metadata = { title: "Rules" };

export default async function RulesPage({ params }: PageProps<"/dashboard/[guildId]/rules">) {
  const { guildId } = await params;
  const { guild } = await loadGuild(guildId);
  const rows = await db().query.commandRules.findMany({
    where: eq(commandRules.guildId, guild.id),
  });
  const report = parseRule(
    "report",
    rows.find((r) => r.command === "report"),
  );
  const status = parseRule(
    "status",
    rows.find((r) => r.command === "status"),
  );

  return (
    <div className="enter">
      <p className="max-w-2xl text-sm leading-relaxed text-ink-2">
        Rules apply to this server only and take effect on the next command, including reports that
        are still being triaged.
      </p>
      <div className="mt-8 grid gap-8 lg:grid-cols-[3fr_2fr] lg:items-start">
        <ReportRuleForm
          guildId={guild.id}
          initial={{ enabled: report.enabled, settings: report.settings }}
          aiConfigured={Boolean(env().GROQ_API_KEY)}
        />
        <StatusRuleForm
          guildId={guild.id}
          initial={{ enabled: status.enabled, settings: status.settings }}
        />
      </div>
    </div>
  );
}
