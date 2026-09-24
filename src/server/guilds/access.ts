import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { type Guild, guildAdmins, guilds } from "../db/schema";

export class GuildAccessError extends Error {
  constructor() {
    super("Server not found");
    this.name = "GuildAccessError";
  }
}

/**
 * The one gate for guild-scoped admin access. Unknown servers and servers the user doesn't
 * administer look identical (not found), so ids can't be probed.
 */
export async function requireGuildAdmin(userId: string, guildId: string): Promise<Guild> {
  if (!/^\d{17,20}$/.test(guildId)) throw new GuildAccessError();
  const [row] = await db()
    .select({ guild: guilds })
    .from(guilds)
    .innerJoin(guildAdmins, eq(guildAdmins.guildId, guilds.id))
    .where(
      and(eq(guilds.id, guildId), eq(guildAdmins.userId, userId), isNull(guilds.disconnectedAt)),
    );
  if (!row) throw new GuildAccessError();
  return row.guild;
}

export async function listGuildsFor(userId: string) {
  const rows = await db()
    .select({ guild: guilds })
    .from(guilds)
    .innerJoin(guildAdmins, eq(guildAdmins.guildId, guilds.id))
    .where(and(eq(guildAdmins.userId, userId), isNull(guilds.disconnectedAt)))
    .orderBy(asc(guilds.name));
  return rows.map((r) => r.guild);
}
