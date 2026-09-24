"use client";

import { useState } from "react";
import { Feedback } from "@/components/feedback";
import { Switch } from "@/components/switch";
import { Button, cx, Field, inputClass, Pill, Spinner } from "@/components/ui";
import { useAction } from "@/components/use-action";
import type { ReportSettings, StatusSettings } from "@/server/guilds/rules";
import { saveRuleAction } from "../actions";

const THRESHOLDS = [
  { value: "low", label: "Every report" },
  { value: "medium", label: "Medium and above" },
  { value: "high", label: "High and above" },
  { value: "critical", label: "Critical only" },
  { value: "", label: "Never" },
];

function Card({
  command,
  summary,
  enabled,
  children,
}: {
  command: string;
  summary: string;
  enabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface">
      <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
        <div>
          <h2 className="font-mono text-[15px] font-semibold">/{command}</h2>
          <p className="mt-1 text-sm text-ink-2">{summary}</p>
        </div>
        {enabled ? <Pill tone="ok">On</Pill> : <Pill>Off</Pill>}
      </div>
      <div className="grid gap-6 px-6 py-6">{children}</div>
    </div>
  );
}

function SaveBar({
  dirty,
  pending,
  result,
}: {
  dirty: boolean;
  pending: boolean;
  result: Parameters<typeof Feedback>[0]["result"];
}) {
  return (
    <div className="flex items-center gap-4 border-t border-line pt-5">
      <Button type="submit" variant="primary" disabled={!dirty || pending}>
        {pending && <Spinner />}
        Save
      </Button>
      {dirty && !pending ? (
        <span className="text-sm text-ink-3">Unsaved changes</span>
      ) : (
        <Feedback result={result} />
      )}
    </div>
  );
}

export function ReportRuleForm({
  guildId,
  initial,
  aiConfigured,
}: {
  guildId: string;
  initial: { enabled: boolean; settings: ReportSettings };
  aiConfigured: boolean;
}) {
  const [saved, setSaved] = useState(initial);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [s, setS] = useState(initial.settings);
  const save = useAction(saveRuleAction);
  const errors = save.result && !save.result.ok ? (save.result.fieldErrors ?? {}) : {};
  const dirty =
    JSON.stringify({ enabled, s }) !==
    JSON.stringify({ enabled: saved.enabled, s: saved.settings });
  const set = <K extends keyof ReportSettings>(k: K, v: ReportSettings[K]) =>
    setS((prev) => ({ ...prev, [k]: v }));

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await save.run(guildId, "report", enabled, s);
        if (r.ok) setSaved({ enabled, settings: s });
      }}
    >
      <Card
        command="report"
        summary="Members file a report through a short form."
        enabled={saved.enabled}
      >
        <Switch
          id="report-enabled"
          label="Accept reports"
          description="When off, /report replies that it's turned off and nothing is filed."
          checked={enabled}
          onChange={setEnabled}
        />
        <div className={cx("grid gap-6", !enabled && "pointer-events-none opacity-50")}>
          <Switch
            id="report-ai"
            label="AI triage"
            description={
              aiConfigured
                ? "Summarise and tag each report before it's posted."
                : "Unavailable: no Groq API key is configured on the server."
            }
            checked={s.aiTriage && aiConfigured}
            disabled={!aiConfigured}
            onChange={(v) => set("aiTriage", v)}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Post to the alert channel"
              htmlFor="alert-min"
              error={errors.alertMinSeverity}
            >
              <select
                id="alert-min"
                className={inputClass}
                value={s.alertMinSeverity ?? ""}
                onChange={(e) =>
                  set(
                    "alertMinSeverity",
                    (e.target.value || null) as ReportSettings["alertMinSeverity"],
                  )
                }
              >
                {THRESHOLDS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Mirror" htmlFor="mirror-min" error={errors.mirrorMinSeverity}>
              <select
                id="mirror-min"
                className={inputClass}
                value={s.mirrorMinSeverity ?? ""}
                onChange={(e) =>
                  set(
                    "mirrorMinSeverity",
                    (e.target.value || null) as ReportSettings["mirrorMinSeverity"],
                  )
                }
              >
                {THRESHOLDS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Severity used for routing"
              htmlFor="severity-source"
              hint="With AI on, a report the reporter marked low but the AI rates high is treated as high."
            >
              <select
                id="severity-source"
                className={inputClass}
                value={s.severitySource}
                onChange={(e) =>
                  set("severitySource", e.target.value as ReportSettings["severitySource"])
                }
              >
                <option value="higher_of_both">Higher of reporter and AI</option>
                <option value="reporter">Reporter's choice only</option>
              </select>
            </Field>
            <div />
            <Field
              label="Role to ping"
              htmlFor="ping-role"
              error={errors.pingRoleId}
              hint="Optional. Right-click a role in Server Settings and Copy Role ID. The role must allow mentions."
            >
              <input
                id="ping-role"
                inputMode="numeric"
                placeholder="e.g. 1187654321098765432"
                className={cx(
                  inputClass,
                  "font-mono text-[13px]",
                  errors.pingRoleId && "border-bad",
                )}
                value={s.pingRoleId ?? ""}
                onChange={(e) => set("pingRoleId", e.target.value.trim() || null)}
              />
            </Field>
            <Field label="Ping when severity is" htmlFor="ping-min">
              <select
                id="ping-min"
                className={inputClass}
                disabled={!s.pingRoleId}
                value={s.pingMinSeverity}
                onChange={(e) =>
                  set("pingMinSeverity", e.target.value as ReportSettings["pingMinSeverity"])
                }
              >
                {THRESHOLDS.slice(0, 4).map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
        <SaveBar dirty={dirty} pending={save.pending} result={save.result} />
      </Card>
    </form>
  );
}

export function StatusRuleForm({
  guildId,
  initial,
}: {
  guildId: string;
  initial: { enabled: boolean; settings: StatusSettings };
}) {
  const [saved, setSaved] = useState(initial);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [s, setS] = useState(initial.settings);
  const save = useAction(saveRuleAction);
  const dirty =
    JSON.stringify({ enabled, s }) !==
    JSON.stringify({ enabled: saved.enabled, s: saved.settings });

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await save.run(guildId, "status", enabled, s);
        if (r.ok) setSaved({ enabled, settings: s });
      }}
    >
      <Card
        command="status"
        summary="Shows how the bot is set up and whether deliveries are healthy."
        enabled={saved.enabled}
      >
        <Switch id="status-enabled" label="Allow /status" checked={enabled} onChange={setEnabled} />
        <div className={cx("grid gap-6", !enabled && "pointer-events-none opacity-50")}>
          <Field label="Who sees the reply" htmlFor="status-visibility">
            <select
              id="status-visibility"
              className={cx(inputClass, "max-w-xs")}
              value={s.visibility}
              onChange={(e) =>
                setS({ ...s, visibility: e.target.value as StatusSettings["visibility"] })
              }
            >
              <option value="private">Only the person who ran it</option>
              <option value="public">Everyone in the channel</option>
            </select>
          </Field>
          <Switch
            id="status-mirror"
            label="Mirror status checks"
            description="Send a short note to the mirror whenever someone runs /status."
            checked={s.mirror}
            onChange={(v) => setS({ ...s, mirror: v })}
          />
        </div>
        <SaveBar dirty={dirty} pending={save.pending} result={save.result} />
      </Card>
    </form>
  );
}
