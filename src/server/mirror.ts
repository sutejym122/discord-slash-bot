import "server-only";
import { send } from "./http";

export type MirrorKind = "slack" | "discord";

// Only real Slack/Discord webhook endpoints are accepted. Besides catching typos, this stops
// the server from being pointed at internal addresses (SSRF) via the settings form.
const PATTERNS: Record<MirrorKind, RegExp> = {
  slack: /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/,
  discord:
    /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d{17,20}\/[\w-]{20,100}$/,
};

export function detectMirrorKind(url: string): MirrorKind | null {
  const trimmed = url.trim();
  for (const kind of Object.keys(PATTERNS) as MirrorKind[]) {
    if (PATTERNS[kind].test(trimmed)) return kind;
  }
  return null;
}

// What the dashboard shows instead of the URL: enough to recognise it, not enough to use it.
export function mirrorHint(kind: MirrorKind, url: string) {
  const tail = url.trim().slice(-4);
  return kind === "slack" ? `hooks.slack.com/…${tail}` : `discord.com/api/webhooks/…${tail}`;
}

export async function deliverMirror(kind: MirrorKind, url: string, text: string) {
  const body =
    kind === "slack"
      ? { text, unfurl_links: false }
      : { content: text, username: "Slash Bot", allowed_mentions: { parse: [] } };

  await send(
    kind,
    url,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    {
      // Deleted or revoked webhooks. Slack uses 403/404/410 depending on the reason.
      permanentCodes: {
        401: "mirror_webhook_invalid",
        403: "mirror_webhook_invalid",
        404: "mirror_webhook_not_found",
        410: "mirror_webhook_not_found",
      },
    },
  );
}
