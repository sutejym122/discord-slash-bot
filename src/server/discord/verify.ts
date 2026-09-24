export type VerifyFailure =
  | "missing_signature"
  | "malformed_signature"
  | "invalid_signature"
  | "stale_timestamp";

export type VerifyResult = { ok: true } | { ok: false; code: VerifyFailure };

// Discord does not document a freshness window, but it signs the timestamp so we can enforce
// one. Five minutes absorbs clock skew without letting a captured request be replayed later.
// Anything replayed inside the window is caught by the interaction id primary key.
export const MAX_TIMESTAMP_SKEW_SECONDS = 300;

const keyCache = new Map<string, Promise<CryptoKey>>();

function importKey(publicKeyHex: string) {
  let key = keyCache.get(publicKeyHex);
  if (!key) {
    key = crypto.subtle.importKey(
      "raw",
      Buffer.from(publicKeyHex, "hex"),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    keyCache.set(publicKeyHex, key);
  }
  return key;
}

export async function verifyDiscordRequest(input: {
  signature: string | null;
  timestamp: string | null;
  rawBody: string;
  publicKeyHex: string;
  nowSeconds?: number;
}): Promise<VerifyResult> {
  const { signature, timestamp, rawBody, publicKeyHex } = input;
  if (!signature || !timestamp) return { ok: false, code: "missing_signature" };
  if (!/^[0-9a-f]{128}$/i.test(signature) || !/^\d{1,12}$/.test(timestamp)) {
    return { ok: false, code: "malformed_signature" };
  }

  // The signed message is the timestamp header followed by the exact bytes Discord sent.
  // The body must not be parsed and re-serialised before this point.
  const message = new TextEncoder().encode(timestamp + rawBody);
  const valid = await crypto.subtle
    .verify(
      { name: "Ed25519" },
      await importKey(publicKeyHex),
      Buffer.from(signature, "hex"),
      message,
    )
    .catch(() => false);
  if (!valid) return { ok: false, code: "invalid_signature" };

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > MAX_TIMESTAMP_SKEW_SECONDS) {
    return { ok: false, code: "stale_timestamp" };
  }
  return { ok: true };
}
