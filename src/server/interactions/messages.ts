import type { Report, Severity } from "../db/schema";
import { MessageFlags } from "../discord/types";

const SEVERITY_COLOR: Record<Severity, number> = {
  low: 0x8b8b84,
  medium: 0x2c5282,
  high: 0xc27c0e,
  critical: 0xb3261e,
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const ButtonStyle = { Primary: 1, Secondary: 2, Success: 3 } as const;

function button(label: string, customId: string, style: number = ButtonStyle.Secondary) {
  return { type: 2, style, label, custom_id: customId };
}

export function ephemeral(content: string) {
  return {
    type: 4,
    data: { content, flags: MessageFlags.Ephemeral, allowed_mentions: { parse: [] } },
  };
}

export function effectiveSeverity(
  report: Pick<Report, "severity" | "aiSeverity">,
  source: "reporter" | "higher_of_both",
): Severity {
  if (source === "reporter" || !report.aiSeverity) return report.severity;
  const order: Severity[] = ["low", "medium", "high", "critical"];
  return order[Math.max(order.indexOf(report.severity), order.indexOf(report.aiSeverity))];
}

export function receiptMessage(report: Pick<Report, "number" | "title" | "aiStatus">) {
  const next =
    report.aiStatus === "pending"
      ? "Triaging it now. This message will update in a few seconds."
      : "The moderators have been notified.";
  return {
    content: `**Report #${report.number} received:** ${clip(report.title, 120)}\n${next}`,
    flags: MessageFlags.Ephemeral,
    allowed_mentions: { parse: [] },
  };
}

function aiFields(report: Report) {
  if (report.aiStatus === "done") {
    return [
      { name: "Summary", value: clip(report.aiSummary ?? "", 1000) },
      ...(report.aiTags?.length
        ? [{ name: "Tags", value: report.aiTags.map((t) => `\`${t}\``).join(" "), inline: true }]
        : []),
      ...(report.aiNextStep
        ? [{ name: "Suggested next step", value: clip(report.aiNextStep, 500) }]
        : []),
    ];
  }
  if (report.aiStatus === "failed") {
    return [{ name: "AI triage", value: "Unavailable right now. Filed without a summary." }];
  }
  return [];
}

export function replyMessage(report: Report, routedTo: string | null) {
  return {
    content: "",
    embeds: [
      {
        title: clip(`Report #${report.number} · ${report.title}`, 256),
        color: SEVERITY_COLOR[report.severity],
        fields: [
          { name: "Severity", value: cap(report.severity), inline: true },
          { name: "Category", value: cap(report.aiCategory ?? report.category), inline: true },
          ...aiFields(report),
        ],
        footer: {
          text: routedTo ? `Shared with moderators in ${routedTo}` : "Logged for the moderators",
        },
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

function statusLine(report: Report) {
  if (report.status === "open") return "Open";
  const who = report.statusChangedBy ? ` by ${report.statusChangedBy}` : "";
  return `${cap(report.status)}${who}`;
}

export function alertComponents(report: Pick<Report, "id" | "status">) {
  const id = report.id;
  const buttons =
    report.status === "open"
      ? [
          button("Acknowledge", `report:ack:${id}`, ButtonStyle.Primary),
          button("Resolve", `report:resolve:${id}`, ButtonStyle.Success),
        ]
      : report.status === "acknowledged"
        ? [button("Resolve", `report:resolve:${id}`, ButtonStyle.Success)]
        : [button("Reopen", `report:reopen:${id}`)];
  return [{ type: 1, components: buttons }];
}

export function alertMessage(
  report: Report,
  severity: Severity,
  pingRoleId: string | null,
): Record<string, unknown> {
  return {
    content: pingRoleId ? `<@&${pingRoleId}>` : "",
    embeds: [
      {
        title: clip(`#${report.number} · ${report.title}`, 256),
        description: clip(report.details, 2000),
        color: report.status === "resolved" ? 0x1f7a4d : SEVERITY_COLOR[severity],
        fields: [
          { name: "Severity", value: cap(severity), inline: true },
          { name: "Category", value: cap(report.aiCategory ?? report.category), inline: true },
          { name: "Status", value: statusLine(report), inline: true },
          { name: "Reported by", value: `<@${report.reporterId}>`, inline: true },
          ...aiFields(report),
        ],
        timestamp: report.createdAt.toISOString(),
      },
    ],
    components: alertComponents(report),
    allowed_mentions: { parse: [], roles: pingRoleId ? [pingRoleId] : [] },
  };
}

export type StatusSnapshot = {
  guildName: string;
  alertChannelName: string | null;
  mirrorKind: "slack" | "discord" | null;
  aiEnabled: boolean;
  openReports: number;
  acknowledgedReports: number;
  reportsLast24h: number;
  retrying: number;
  failedLast24h: number;
  lastFailure: string | null;
};

export function statusMessage(s: StatusSnapshot, visibility: "private" | "public", now: Date) {
  const delivery =
    s.retrying === 0 && s.failedLast24h === 0
      ? "All deliveries caught up"
      : [
          s.retrying ? `${s.retrying} retrying` : null,
          s.failedLast24h ? `${s.failedLast24h} failed in the last 24h` : null,
        ]
          .filter(Boolean)
          .join(", ");
  return {
    embeds: [
      {
        title: clip(`Slash Bot on ${s.guildName}`, 256),
        color: s.failedLast24h ? 0xb3261e : s.retrying ? 0xc27c0e : 0x1f7a4d,
        fields: [
          {
            name: "Alert channel",
            value: s.alertChannelName ? `#${s.alertChannelName}` : "Not set",
            inline: true,
          },
          {
            name: "Mirror",
            value: s.mirrorKind ? `${cap(s.mirrorKind)} webhook` : "Not set",
            inline: true,
          },
          { name: "AI triage", value: s.aiEnabled ? "On" : "Off", inline: true },
          {
            name: "Open reports",
            value: `${s.openReports} open, ${s.acknowledgedReports} acknowledged`,
            inline: true,
          },
          { name: "Last 24 hours", value: `${s.reportsLast24h} reports`, inline: true },
          { name: "Delivery", value: delivery, inline: true },
          ...(s.lastFailure ? [{ name: "Last failure", value: clip(s.lastFailure, 300) }] : []),
        ],
        footer: { text: "Updated" },
        timestamp: now.toISOString(),
      },
    ],
    components: [{ type: 1, components: [button("Refresh", "status:refresh")] }],
    flags: visibility === "private" ? MessageFlags.Ephemeral : 0,
    allowed_mentions: { parse: [] },
  };
}

export function mirrorText(
  guildName: string,
  event:
    | { kind: "report"; report: Report; severity: Severity }
    | { kind: "status_change"; report: Report; actor: string }
    | { kind: "status_check"; actor: string },
): string {
  if (event.kind === "status_check") return `${guildName}: ${event.actor} ran /status`;
  const r = event.report;
  if (event.kind === "status_change") {
    return `${guildName}: report #${r.number} "${clip(r.title, 80)}" marked ${r.status} by ${event.actor}`;
  }
  const lines = [
    `${guildName}: new ${event.severity} report #${r.number} from ${r.reporterName}`,
    `"${clip(r.title, 120)}" (${r.aiCategory ?? r.category})`,
  ];
  if (r.aiStatus === "done" && r.aiSummary) lines.push(clip(r.aiSummary, 400));
  return lines.join("\n");
}
