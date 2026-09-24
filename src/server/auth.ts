import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "./db/client";
import { accounts, rateLimits, sessions, users, verifications } from "./db/schema";
import { env } from "./env";

function createAuth() {
  const e = env();
  return betterAuth({
    baseURL: e.APP_URL,
    secret: e.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db(), {
      provider: "pg",
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
        rateLimit: rateLimits,
      },
    }),
    // Admin accounts are created with `pnpm admin:create`; there is no public sign-up.
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 10 },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    // Stored in Postgres because serverless instances don't share memory.
    rateLimit: {
      enabled: e.NODE_ENV !== "test",
      storage: "database",
      customRules: { "/sign-in/email": { window: 60, max: 5 } },
    },
    advanced: { useSecureCookies: e.APP_URL.startsWith("https://") },
    plugins: [nextCookies()],
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

export function auth() {
  instance ??= createAuth();
  return instance;
}
