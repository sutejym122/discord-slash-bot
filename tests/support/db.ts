import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { commandRules, guildAdmins, guilds, users } from "@/server/db/schema";
import { snowflake } from "./discord";

export async function resetDb() {
  await db().execute(sql`
    truncate table job_attempts, jobs, reports, interactions, command_rules, guild_admins,
      guilds, sessions, accounts, verifications, rate_limits, users restart identity cascade
  `);
}

export async function createGuild(overrides: Partial<typeof guilds.$inferInsert> = {}) {
  const [guild] = await db()
    .insert(guilds)
    .values({ id: snowflake(), name: "Test Server", ...overrides })
    .returning();
  return guild;
}

export async function setRule(guildId: string, command: string, enabled: boolean, settings = {}) {
  await db()
    .insert(commandRules)
    .values({ guildId, command, enabled, settings })
    .onConflictDoUpdate({
      target: [commandRules.guildId, commandRules.command],
      set: { enabled, settings },
    });
}

export async function createUser(email: string) {
  const [user] = await db()
    .insert(users)
    .values({ id: crypto.randomUUID(), email, name: email.split("@")[0] })
    .returning();
  return user;
}

export async function makeAdmin(guildId: string, userId: string) {
  await db().insert(guildAdmins).values({ guildId, userId });
}
