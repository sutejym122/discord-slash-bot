import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "@/server/crypto";

describe("encrypt/decrypt", () => {
  it("round-trips and never reuses an IV", () => {
    const url = "https://hooks.slack.com/services/T000/B000/abc";
    const a = encrypt(url);
    const b = encrypt(url);
    expect(a).not.toEqual(b);
    expect(a).not.toContain("hooks.slack.com");
    expect(decrypt(a)).toBe(url);
  });

  it("rejects tampered ciphertext", () => {
    const parts = encrypt("secret").split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
});
