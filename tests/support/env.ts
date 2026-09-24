import { generateKeyPairSync, randomBytes } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");

Object.assign(process.env, {
  NODE_ENV: "test",
  APP_URL: "http://localhost:3000",
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://app:app@localhost:5432/slashbot_test",
  BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
  ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  CRON_SECRET: "test-cron-secret-0123456789abcdef",
  DISCORD_APPLICATION_ID: "100000000000000001",
  // Raw 32 byte key is the tail of the SPKI DER encoding.
  DISCORD_PUBLIC_KEY: publicKey
    .export({ format: "der", type: "spki" })
    .subarray(12)
    .toString("hex"),
  TEST_DISCORD_PRIVATE_KEY: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  DISCORD_BOT_TOKEN: "test-bot-token-".padEnd(60, "x"),
  DISCORD_CLIENT_SECRET: "test-client-secret",
  GROQ_API_KEY: "test-groq-key",
  LOG_LEVEL: "error",
});
