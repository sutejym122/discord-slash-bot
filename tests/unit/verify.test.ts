import { describe, expect, it } from "vitest";
import { MAX_TIMESTAMP_SKEW_SECONDS, verifyDiscordRequest } from "@/server/discord/verify";
import { signBody } from "../support/discord";

const publicKeyHex = () => process.env.DISCORD_PUBLIC_KEY as string;
const body = JSON.stringify({ type: 1, id: "1" });

describe("verifyDiscordRequest", () => {
  it("accepts a correctly signed, fresh request", async () => {
    const { signature, timestamp } = signBody(body);
    const result = await verifyDiscordRequest({
      signature,
      timestamp,
      rawBody: body,
      publicKeyHex: publicKeyHex(),
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejects missing headers", async () => {
    const result = await verifyDiscordRequest({
      signature: null,
      timestamp: null,
      rawBody: body,
      publicKeyHex: publicKeyHex(),
    });
    expect(result).toEqual({ ok: false, code: "missing_signature" });
  });

  it("rejects a signature that isn't hex of the right length", async () => {
    const result = await verifyDiscordRequest({
      signature: "zz",
      timestamp: "123",
      rawBody: body,
      publicKeyHex: publicKeyHex(),
    });
    expect(result).toEqual({ ok: false, code: "malformed_signature" });
  });

  it("rejects a body that was changed after signing, even by whitespace", async () => {
    const { signature, timestamp } = signBody(body);
    const reserialised = JSON.stringify(JSON.parse(body), null, 1);
    const result = await verifyDiscordRequest({
      signature,
      timestamp,
      rawBody: reserialised,
      publicKeyHex: publicKeyHex(),
    });
    expect(result).toEqual({ ok: false, code: "invalid_signature" });
  });

  it("rejects a signature over a different timestamp", async () => {
    const { signature, timestamp } = signBody(body);
    const result = await verifyDiscordRequest({
      signature,
      timestamp: String(Number(timestamp) + 1),
      rawBody: body,
      publicKeyHex: publicKeyHex(),
    });
    expect(result).toEqual({ ok: false, code: "invalid_signature" });
  });

  it("rejects a validly signed request outside the freshness window", async () => {
    const old = Math.floor(Date.now() / 1000) - MAX_TIMESTAMP_SKEW_SECONDS - 5;
    const { signature, timestamp } = signBody(body, String(old));
    const result = await verifyDiscordRequest({
      signature,
      timestamp,
      rawBody: body,
      publicKeyHex: publicKeyHex(),
    });
    expect(result).toEqual({ ok: false, code: "stale_timestamp" });
  });

  it("rejects a request signed by a different key", async () => {
    const { signature, timestamp } = signBody(body);
    const otherKey = "a".repeat(64);
    const result = await verifyDiscordRequest({
      signature,
      timestamp,
      rawBody: body,
      publicKeyHex: otherKey,
    });
    expect(result.ok).toBe(false);
  });
});
