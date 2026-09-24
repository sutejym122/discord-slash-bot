import "server-only";
import { z } from "zod";

const snowflake = z.string().regex(/^\d{17,20}$/, "must be a Discord snowflake id");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url(),
  DATABASE_URL: z.url(),

  BETTER_AUTH_SECRET: z.string().min(32),
  // 32 random bytes, base64. Used for AES-GCM on mirror URLs and interaction tokens.
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64 encoded"),
  CRON_SECRET: z.string().min(24),

  DISCORD_APPLICATION_ID: snowflake,
  DISCORD_PUBLIC_KEY: z.string().regex(/^[0-9a-f]{64}$/i, "must be the 64 char hex public key"),
  DISCORD_BOT_TOKEN: z.string().min(50),
  DISCORD_CLIENT_SECRET: z.string().min(16),

  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default("openai/gpt-oss-20b"),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Only report which variables are wrong, never their values.
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n  ${problems.join("\n  ")}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvForTests() {
  cached = undefined;
}
