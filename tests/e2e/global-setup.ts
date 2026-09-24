import { execFileSync } from "node:child_process";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { e2eEnv } from "../../playwright.config";

export const E2E = {
  password: "correct-horse-battery",
  alice: "alice@example.com",
  guildId: "111111111111111111",
  otherGuildId: "222222222222222222",
};

// Fresh database, two admins (through the same CLI a real deploy uses) and one server each.
export default async function setup() {
  const sql = postgres(e2eEnv.DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await sql`drop schema if exists public cascade`;
    await sql`drop schema if exists drizzle cascade`;
    await sql`create schema public`;
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });

    for (const email of [E2E.alice, "bob@example.com"]) {
      execFileSync("pnpm", ["-s", "admin:create", email, E2E.password], {
        env: { ...process.env, ...e2eEnv },
        stdio: "ignore",
      });
    }
    await sql`insert into guilds (id, name) values
      (${E2E.guildId}, 'Night Owls'), (${E2E.otherGuildId}, 'Someone Else')`;
    await sql`insert into guild_admins (guild_id, user_id)
      select ${E2E.guildId}, id from users where email = ${E2E.alice}
      union all
      select ${E2E.otherGuildId}, id from users where email = 'bob@example.com'`;
  } finally {
    await sql.end();
  }
}
