import "server-only";
import { InteractionType, interactionSchema, ResponseType } from "../discord/types";
import { verifyDiscordRequest } from "../discord/verify";
import { env } from "../env";
import { log } from "../log";
import { handleInteraction } from "./handle";

// Discord payloads are a few KB. Anything much larger is not from Discord.
const MAX_BODY_BYTES = 64 * 1024;

type Deps = {
  // Runs work after the response has been sent (Next's `after` in production).
  schedule: (task: () => Promise<void>) => void;
  onAccepted?: (interactionId: string) => Promise<void>;
};

function reject(status: number, code: string) {
  return Response.json({ error: code }, { status });
}

export async function handleInteractionRequest(req: Request, deps: Deps): Promise<Response> {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return reject(413, "payload_too_large");

  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) return reject(413, "payload_too_large");

  const verified = await verifyDiscordRequest({
    signature: req.headers.get("x-signature-ed25519"),
    timestamp: req.headers.get("x-signature-timestamp"),
    rawBody,
    publicKeyHex: env().DISCORD_PUBLIC_KEY,
  });
  if (!verified.ok) {
    log.warn("interaction.rejected", { reason: verified.code });
    return reject(401, verified.code);
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    log.warn("interaction.rejected", { reason: "malformed_json" });
    return reject(400, "malformed_json");
  }

  const parsed = interactionSchema.safeParse(json);
  if (!parsed.success) {
    log.warn("interaction.rejected", {
      reason: "invalid_payload",
      issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join(".")),
    });
    return reject(400, "invalid_payload");
  }

  const interaction = parsed.data;
  if (interaction.application_id !== env().DISCORD_APPLICATION_ID) {
    log.warn("interaction.rejected", { reason: "wrong_application" });
    return reject(400, "wrong_application");
  }

  if (interaction.type === InteractionType.Ping) {
    return Response.json({ type: ResponseType.Pong });
  }

  try {
    const outcome = await handleInteraction(interaction);
    if (!outcome.duplicate && outcome.result === "accepted" && deps.onAccepted) {
      const run = deps.onAccepted;
      deps.schedule(() => run(interaction.id));
    }
    return Response.json(outcome.response);
  } catch (error) {
    // Nothing was committed (the handler is one transaction), so a 500 is honest: Discord
    // shows the user "interaction failed" and no half-recorded state is left behind.
    log.error("interaction.failed", { interactionId: interaction.id, error });
    return reject(500, "internal_error");
  }
}
