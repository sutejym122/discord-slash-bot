import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { type AdminRole, type Guild, guildAdmins, guilds } from "../db/schema";

export class GuildAccessError extends Error {
  constructor() {
    super("Server not found");
    this.name = "GuildAccessError";
  }
}

export class OwnerRequiredError extends Error {
  constructor() {
    super("Only the server's owner can do that");
    this.name = "OwnerRequiredError";
  }
}

/**
 * The one gate for guild-scoped admin access. Unknown servers and servers the user doesn't
 * administer look identical (not found), so ids can't be probed.
 */
export async function getGuildAccess(
  userId: string,
  guildId: string,
): Promise<{ guild: Guild; role: AdminRole }> {
  if (!/^\d{17,20}$/.test(guildId)) throw new GuildAccessError();
  const [row] = await db()
    .select({ guild: guilds, role: guildAdmins.role })
    .from(guilds)
    .innerJoin(guildAdmins, eq(guildAdmins.guildId, guilds.id))
    .where(
      and(eq(guilds.id, guildId), eq(guildAdmins.userId, userId), isNull(guilds.disconnectedAt)),
    );
  if (!row) throw new GuildAccessError();
  return row;
}

export async function requireGuildAdmin(userId: string, guildId: string): Promise<Guild> {
  return (await getGuildAccess(userId, guildId)).guild;
}

export async function requireGuildOwner(userId: string, guildId: string): Promise<Guild> {
  const { guild, role } = await getGuildAccess(userId, guildId);
  if (role !== "owner") throw new OwnerRequiredError();
  return guild;
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
