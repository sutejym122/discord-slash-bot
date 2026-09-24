"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Feedback } from "@/components/feedback";
import { RelativeTime } from "@/components/relative-time";
import { Button, cx, Dot, EmptyState, Pill, Spinner, type Tone } from "@/components/ui";
import { useAction } from "@/components/use-action";
import type { ActivityFilter, ActivityItem } from "@/server/guilds/activity";
import { retryJobAction } from "./actions";

type Health = { retrying: number; running: number; failed: number };
type Page = { items: ActivityItem[]; hasMore: boolean; health: Health };
type Job = ActivityItem["jobs"][number];

const POLL_MS = 4_000;

const JOB_LABEL: Record<Job["kind"], string> = {
  triage: "AI triage",
  reply: "Reply",
  channel_post: "Alert post",
  mirror: "Mirror",
};

const JOB_TONE: Record<Job["status"], Tone> = {
  pending: "neutral",
  running: "info",
  retrying: "warn",
  succeeded: "ok",
  failed: "bad",
};

const RESULT_LABEL: Record<string, { label: string; tone: Tone }> = {
  unconfigured_guild: { label: "Not connected", tone: "warn" },
  command_disabled: { label: "Turned off", tone: "neutral" },
  forbidden: { label: "Not allowed", tone: "warn" },
  invalid: { label: "Rejected", tone: "bad" },
};

const BUTTON_LABEL: Record<string, string> = {
  ack: "Acknowledged",
  resolve: "Resolved",
  reopen: "Reopened",
};

function describe(item: ActivityItem) {
  if (item.type === 2) return { command: `/${item.name}`, detail: null };
  if (item.type === 5) return { command: "/report", detail: "form submitted" };
  if (item.type === 3) {
    if (item.name === "status:refresh") return { command: "Refresh", detail: "status" };
    const action = item.name.split(":")[1];
    return { command: BUTTON_LABEL[action] ?? "Button", detail: "report" };
  }
  return { command: item.name, detail: null };
}

function JobChip({ job }: { job: Job }) {
  const active = job.status === "running" || job.status === "pending";
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-ink-2"
      title={job.lastError ?? undefined}
    >
      <Dot tone={JOB_TONE[job.status]} pulse={active || job.status === "retrying"} />
      {JOB_LABEL[job.kind]}
      {job.status === "retrying" && (
        <span className="tabular text-warn">
          {job.attempts}/{job.maxAttempts}
        </span>
      )}
    </span>
  );
}

function JobDetail({ guildId, job }: { guildId: string; job: Job }) {
  const retry = useAction(retryJobAction);
  const canRetry = job.status === "failed" && job.lastErrorCode !== "interaction_token_expired";
  return (
    <div className="rounded-lg border border-line bg-bg px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">{JOB_LABEL[job.kind]}</span>
          <Pill tone={JOB_TONE[job.status]} pulse={job.status === "retrying"}>
            {job.status === "succeeded" && job.attempts > 1
              ? `Recovered after ${job.attempts} attempts`
              : job.status}
          </Pill>
        </div>
        <div className="flex items-center gap-3 text-xs text-ink-3">
          {job.status === "retrying" && (
            <span>
              next try <RelativeTime value={job.runAt} />
            </span>
          )}
          <span className="tabular">
            attempt {job.attempts} of {job.maxAttempts}
          </span>
          {canRetry && (
            <Button size="sm" onClick={() => retry.run(guildId, job.id)} disabled={retry.pending}>
              {retry.pending && <Spinner />}
              Retry
            </Button>
          )}
        </div>
      </div>
      {job.lastError && job.status !== "succeeded" && (
        <p className="mt-2 font-mono text-xs leading-relaxed break-words text-bad">
          {job.lastErrorCode}: {job.lastError}
        </p>
      )}
      {job.history.length > 0 && (
        <ol className="mt-3 grid gap-1 border-t border-line pt-3">
          {job.history.map((a) => (
            <li
              key={a.attempt}
              className="grid grid-cols-[4.5rem_1fr_auto] items-baseline gap-3 text-xs"
            >
              <span className="tabular text-ink-3">#{a.attempt}</span>
              <span
                className={cx("truncate", a.outcome === "succeeded" ? "text-ok" : "text-ink-2")}
              >
                {a.outcome === "succeeded"
                  ? "Delivered"
                  : `${a.outcome === "retryable_error" ? "Failed, will retry" : "Failed permanently"}${a.httpStatus ? ` (HTTP ${a.httpStatus})` : ""}`}
              </span>
              <span className="tabular text-ink-3">
                {a.durationMs} ms · <RelativeTime value={a.startedAt} />
              </span>
            </li>
          ))}
        </ol>
      )}
      <Feedback result={retry.result} />
    </div>
  );
}

function ReportDetail({ report }: { report: NonNullable<ActivityItem["report"]> }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <p className="text-xs font-medium text-ink-3">Report #{report.number}</p>
        <p className="mt-1 font-medium">{report.title}</p>
        <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-ink-2">
          {report.details}
        </p>
        <p className="mt-3 text-xs text-ink-3">
          Filed by {report.reporterName} as {report.severity}, {report.category}. Status:{" "}
          {report.status}
          {report.statusChangedBy ? ` by ${report.statusChangedBy}` : ""}.
        </p>
      </div>
      <div className="rounded-lg bg-surface-2 px-4 py-3.5">
        <p className="text-xs font-medium text-ink-3">AI triage</p>
        {report.aiStatus === "done" ? (
          <div className="mt-1.5 grid gap-2 text-sm">
            <p className="leading-relaxed">{report.aiSummary}</p>
            <p className="text-ink-2">
              {report.aiSeverity} · {report.aiCategory}
            </p>
            {report.aiTags && report.aiTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {report.aiTags.map((t) => (
                  <span
                    key={t}
                    className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-xs text-ink-2"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
            {report.aiNextStep && <p className="text-ink-2">Next: {report.aiNextStep}</p>}
          </div>
        ) : (
          <p className="mt-1.5 text-sm text-ink-2">
            {report.aiStatus === "pending"
              ? "Waiting for the model."
              : report.aiStatus === "skipped"
                ? "Skipped. AI triage was off or not configured when this was filed."
                : `Unavailable, so the report went out without it. ${report.aiError ?? ""}`}
          </p>
        )}
      </div>
    </div>
  );
}

function Row({ guildId, item }: { guildId: string; item: ActivityItem }) {
  const [open, setOpen] = useState(false);
  const { command, detail } = describe(item);
  const result = RESULT_LABEL[item.result];
  const expandable = Boolean(item.report || item.jobs.length);
  const attention = item.jobs.some((j) => j.status === "failed");

  return (
    <li className={cx("bg-surface", attention && "shadow-[inset_2px_0_0_var(--bad)]")}>
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="grid w-full grid-cols-[5.5rem_1fr] items-center gap-x-4 gap-y-2 px-5 py-3.5 text-left transition-colors enabled:hover:bg-surface-2 md:grid-cols-[6.5rem_9rem_minmax(0,1fr)_auto]"
      >
        <RelativeTime value={item.receivedAt} className="tabular text-xs text-ink-3" />
        <span className="truncate text-sm text-ink-2">{item.userName ?? "Unknown"}</span>
        <span className="col-span-2 min-w-0 truncate text-sm md:col-span-1">
          <span className="font-mono font-medium">{command}</span>
          {item.report ? (
            <span className="text-ink-2">
              {"  "}#{item.report.number} {item.report.title}
            </span>
          ) : (
            detail && <span className="text-ink-3"> {detail}</span>
          )}
        </span>
        <span className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-1 md:col-span-1 md:justify-end">
          {result ? (
            <Pill tone={result.tone}>{result.label}</Pill>
          ) : item.jobs.length ? (
            item.jobs.map((j) => <JobChip key={j.id} job={j} />)
          ) : (
            <span className="text-xs text-ink-3">Answered in {item.handleMs ?? "?"} ms</span>
          )}
        </span>
      </button>
      {open && (
        <div className="grid gap-4 border-t border-line px-5 py-5 enter">
          {item.report && <ReportDetail report={item.report} />}
          {item.jobs.length > 0 && (
            <div className="grid gap-2">
              {item.jobs.map((j) => (
                <JobDetail key={j.id} guildId={guildId} job={j} />
              ))}
            </div>
          )}
          <p className="font-mono text-[11px] text-ink-3">
            interaction {item.id} · handled in {item.handleMs ?? "?"} ms
          </p>
        </div>
      )}
    </li>
  );
}

function HealthLine({ health }: { health: Health }) {
  if (!health.retrying && !health.failed) {
    return (
      <Pill tone="ok" pulse={health.running > 0}>
        {health.running ? "Delivering" : "All deliveries caught up"}
      </Pill>
    );
  }
  return (
    <span className="flex gap-2">
      {health.retrying > 0 && (
        <Pill tone="warn" pulse>
          {health.retrying} retrying
        </Pill>
      )}
      {health.failed > 0 && <Pill tone="bad">{health.failed} failed in 24h</Pill>}
    </span>
  );
}

const FILTERS: { value: ActivityFilter; label: string }[] = [
  { value: "all", label: "Everything" },
  { value: "reports", label: "Reports" },
  { value: "attention", label: "Needs attention" },
];

export function ActivityLog({
  guildId,
  guildName,
  initial,
}: {
  guildId: string;
  guildName: string;
  initial: Page;
}) {
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [page, setPage] = useState<Page>(initial);
  const [older, setOlder] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const filterRef = useRef(filter);

  const load = useCallback(
    async (f: ActivityFilter) => {
      try {
        const res = await fetch(`/api/guilds/${guildId}/activity?filter=${f}`, {
          cache: "no-store",
        });
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as Page;
        if (filterRef.current === f) {
          setPage(data);
          setStale(false);
        }
      } catch {
        setStale(true);
      }
    },
    [guildId],
  );

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") load(filterRef.current);
    };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load]);

  async function changeFilter(f: ActivityFilter) {
    filterRef.current = f;
    setFilter(f);
    setOlder([]);
    setLoading(true);
    await load(f);
    setLoading(false);
  }

  async function loadOlder() {
    const all = [...page.items, ...older];
    const last = all[all.length - 1];
    if (!last) return;
    setLoading(true);
    const res = await fetch(
      `/api/guilds/${guildId}/activity?filter=${filter}&before=${encodeURIComponent(last.receivedAt)}`,
    );
    if (res.ok) {
      const data = (await res.json()) as Page;
      setOlder((prev) => [...prev, ...data.items]);
      setPage((p) => ({ ...p, hasMore: data.hasMore }));
    }
    setLoading(false);
  }

  const items = [...page.items, ...older.filter((o) => !page.items.some((i) => i.id === o.id))];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5" role="tablist">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={filter === f.value}
              onClick={() => changeFilter(f.value)}
              className={cx(
                "h-8 rounded-md px-3 text-sm transition-colors",
                filter === f.value ? "bg-ink text-bg" : "text-ink-2 hover:text-ink",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-xs text-ink-3">
          {loading && <Spinner className="size-3.5" />}
          <HealthLine health={page.health} />
          <span
            className="flex items-center gap-1.5"
            title={stale ? "Couldn't refresh" : "Refreshes every few seconds"}
          >
            <Dot tone={stale ? "bad" : "ok"} pulse={!stale} />
            {stale ? "Offline" : "Live"}
          </span>
        </div>
      </div>

      <div className="mt-6">
        {items.length === 0 ? (
          <EmptyState
            title={filter === "attention" ? "Nothing needs attention" : "No activity yet"}
          >
            {filter === "attention"
              ? "Failed and retrying deliveries show up here."
              : `Run /report or /status in ${guildName} and it will appear here within a few seconds.`}
          </EmptyState>
        ) : (
          <ul className="grid gap-px overflow-hidden rounded-xl border border-line bg-line">
            {items.map((item) => (
              <Row key={item.id} guildId={guildId} item={item} />
            ))}
          </ul>
        )}
        {page.hasMore && (
          <div className="mt-6 flex justify-center">
            <Button onClick={loadOlder} disabled={loading}>
              Show older
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
