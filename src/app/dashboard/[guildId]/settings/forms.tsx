"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Feedback } from "@/components/feedback";
import { RelativeTime } from "@/components/relative-time";
import { Button, Field, inputClass, Pill, Spinner } from "@/components/ui";
import { useAction } from "@/components/use-action";
import {
  disconnectAction,
  removeMirrorAction,
  revokeAccessAction,
  saveAlertChannelAction,
  saveMirrorAction,
  shareAccessAction,
  simulateOutageAction,
  testMirrorAction,
} from "../actions";

type Channel = { id: string; name: string; category: string | null };

export function ChannelPicker({
  guildId,
  channels,
  current,
}: {
  guildId: string;
  channels: Channel[];
  current: string | null;
}) {
  const [value, setValue] = useState(current ?? "");
  const save = useAction(saveAlertChannelAction);
  const dirty = value !== (current ?? "");

  const grouped = new Map<string, Channel[]>();
  for (const c of channels) {
    const key = c.category ?? "";
    grouped.set(key, [...(grouped.get(key) ?? []), c]);
  }

  return (
    <form
      className="grid max-w-md gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.run(guildId, value || null);
      }}
    >
      <Field
        label="Alert channel"
        htmlFor="channel"
        hint="The bot needs View Channel, Send Messages and Embed Links here."
      >
        <select
          id="channel"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            save.clear();
          }}
          className={inputClass}
        >
          <option value="">Don't post reports to a channel</option>
          {[...grouped.entries()].map(([category, list]) =>
            category ? (
              <optgroup key={category} label={category}>
                {list.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name}
                  </option>
                ))}
              </optgroup>
            ) : (
              list.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                </option>
              ))
            ),
          )}
        </select>
      </Field>
      <div className="flex items-center gap-4">
        <Button type="submit" variant="primary" disabled={!dirty || save.pending}>
          {save.pending && <Spinner />}
          Save channel
        </Button>
        <Feedback result={save.result} />
      </div>
    </form>
  );
}

export function MirrorForm({
  guildId,
  kind,
  hint,
}: {
  guildId: string;
  kind: "slack" | "discord" | null;
  hint: string | null;
}) {
  const [editing, setEditing] = useState(!kind);
  const [url, setUrl] = useState("");
  const save = useAction(saveMirrorAction);
  const test = useAction(testMirrorAction);
  const remove = useAction(removeMirrorAction);

  if (!editing && kind) {
    return (
      <div className="grid max-w-md gap-4">
        <div className="flex items-center justify-between gap-4 rounded-lg border border-line bg-surface px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{kind === "slack" ? "Slack" : "Discord"} webhook</p>
            <p className="mt-0.5 truncate font-mono text-xs text-ink-3">{hint}</p>
          </div>
          <Pill tone="ok">Saved</Pill>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => test.run(guildId)} disabled={test.pending}>
            {test.pending && <Spinner />}
            Send test message
          </Button>
          <Button variant="ghost" onClick={() => setEditing(true)}>
            Replace
          </Button>
          <Button variant="ghost" onClick={() => remove.run(guildId)} disabled={remove.pending}>
            Remove
          </Button>
        </div>
        <Feedback result={test.result ?? remove.result} />
      </div>
    );
  }

  return (
    <form
      className="grid max-w-md gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await save.run(guildId, url);
        if (r.ok) {
          setUrl("");
          setEditing(false);
        }
      }}
    >
      <Field
        label="Webhook URL"
        htmlFor="mirror"
        error={save.result && !save.result.ok ? save.result.error : undefined}
        hint="A Slack incoming webhook or a Discord channel webhook. It's stored encrypted and never shown again."
      >
        <input
          id="mirror"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://hooks.slack.com/services/…"
          autoComplete="off"
          spellCheck={false}
          className={`${inputClass} font-mono text-[13px]`}
        />
      </Field>
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" disabled={!url.trim() || save.pending}>
          {save.pending && <Spinner />}
          Save webhook
        </Button>
        {kind && (
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

export function OutageTool({
  guildId,
  until,
  hasMirror,
}: {
  guildId: string;
  until: string | null;
  hasMirror: boolean;
}) {
  const action = useAction(simulateOutageAction);
  const active = until !== null && new Date(until) > new Date();
  return (
    <div className="grid max-w-md gap-4">
      {active && until && (
        <div className="flex items-center gap-3 text-sm">
          <Pill tone="warn" pulse>
            Outage active
          </Pill>
          <span className="text-ink-2">
            ends <RelativeTime value={until} />
          </span>
        </div>
      )}
      <div className="flex items-center gap-2">
        {active ? (
          <Button onClick={() => action.run(guildId, null)} disabled={action.pending}>
            End outage now
          </Button>
        ) : (
          <Button onClick={() => action.run(guildId, 5)} disabled={action.pending || !hasMirror}>
            Simulate a 5 minute outage
          </Button>
        )}
      </div>
      {!hasMirror && <p className="text-xs text-ink-3">Add a mirror webhook first.</p>}
      <Feedback result={action.result} />
    </div>
  );
}

export function DisconnectButton({ guildId, guildName }: { guildId: string; guildName: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const action = useAction(disconnectAction);

  if (!confirming) {
    return (
      <Button variant="danger" onClick={() => setConfirming(true)}>
        Disconnect server
      </Button>
    );
  }
  return (
    <div className="grid max-w-md gap-3">
      <p className="text-sm text-ink-2">
        The bot leaves <strong className="text-ink">{guildName}</strong> and commands there stop
        working. History stays here. You can reconnect later.
      </p>
      <div className="flex gap-2">
        <Button
          variant="danger"
          disabled={action.pending}
          onClick={async () => {
            const r = await action.run(guildId);
            if (r.ok) router.replace("/dashboard");
          }}
        >
          {action.pending && <Spinner />}
          Yes, disconnect
        </Button>
        <Button variant="ghost" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
      <Feedback result={action.result} />
    </div>
  );
}

type Admin = { userId: string; email: string; role: "owner" | "admin"; addedAt: string };

export function AccessList({
  guildId,
  currentUserId,
  canManage,
  admins,
}: {
  guildId: string;
  currentUserId: string;
  canManage: boolean;
  admins: Admin[];
}) {
  const [email, setEmail] = useState("");
  const share = useAction(shareAccessAction);
  const revoke = useAction(revokeAccessAction);

  return (
    <div className="grid max-w-md gap-5">
      <ul className="grid gap-px overflow-hidden rounded-lg border border-line bg-line">
        {admins.map((a) => (
          <li
            key={a.userId}
            className="flex items-center justify-between gap-3 bg-surface px-4 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm">
                {a.email}
                {a.userId === currentUserId && <span className="text-ink-3"> (you)</span>}
              </p>
              <p className="mt-0.5 text-xs text-ink-3">
                {a.role === "owner" ? "Owner" : "Admin"} · added <RelativeTime value={a.addedAt} />
              </p>
            </div>
            {canManage && a.role === "admin" && (
              <Button
                size="sm"
                variant="ghost"
                disabled={revoke.pending}
                onClick={() => revoke.run(guildId, a.userId)}
              >
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await share.run(guildId, email);
            if (r.ok) setEmail("");
          }}
        >
          <Field
            label="Add someone"
            htmlFor="share-email"
            error={share.result && !share.result.ok ? share.result.error : undefined}
            hint="They need an existing account. They'll see this server next time they sign in."
          >
            <div className="flex gap-2">
              <input
                id="share-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className={inputClass}
              />
              <Button type="submit" disabled={!email.trim() || share.pending}>
                {share.pending && <Spinner />}
                Add
              </Button>
            </div>
          </Field>
        </form>
      )}
      <Feedback result={share.result?.ok ? share.result : revoke.result} />
    </div>
  );
}
