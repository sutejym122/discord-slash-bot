import { generateKeyPairSync, randomBytes } from "node:crypto";
import { defineConfig } from "@playwright/test";

// The browser tests run against a real `next dev` server with its own database and a signing
// key generated per run, so they can send properly signed interactions like Discord does.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
process.env.E2E_PRIVATE_KEY ??= privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const publicKeyHex =
  process.env.E2E_PUBLIC_KEY ??
  publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("hex");
process.env.E2E_PUBLIC_KEY = publicKeyHex;

const PORT = 3100;
export const e2eEnv = {
  NODE_ENV: "development" as const,
  APP_URL: `http://localhost:${PORT}`,
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgres://app:app@localhost:5432/slashbot_e2e",
  BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
  ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  CRON_SECRET: randomBytes(24).toString("hex"),
  DISCORD_APPLICATION_ID: "100000000000000001",
  DISCORD_PUBLIC_KEY: publicKeyHex,
  DISCORD_BOT_TOKEN: "e2e-bot-token-".padEnd(60, "x"),
  DISCORD_CLIENT_SECRET: "e2e-client-secret",
  GROQ_API_KEY: "",
  LOG_LEVEL: "warn",
};

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: e2eEnv.APP_URL,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : undefined,
  },
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    // Playwright starts the server before globalSetup migrates, so wait on a static file.
    url: `${e2eEnv.APP_URL}/favicon.ico`,
    env: e2eEnv,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
