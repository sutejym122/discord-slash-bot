import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { GuildAccessError, getGuildAccess } from "@/server/guilds/access";
import { requireUser } from "@/server/session";

// Deduped per request, so the layout and page share one lookup.
export const loadGuild = cache(async (guildId: string) => {
  const user = await requireUser();
  try {
    return { user, ...(await getGuildAccess(user.id, guildId)) };
  } catch (error) {
    if (error instanceof GuildAccessError) notFound();
    throw error;
  }
});
