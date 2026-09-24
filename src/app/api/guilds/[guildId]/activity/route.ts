import { GuildAccessError, requireGuildAdmin } from "@/server/guilds/access";
import { type ActivityFilter, deliveryHealth, getActivity } from "@/server/guilds/activity";
import { sessionFromRequest } from "@/server/session";

const FILTERS = new Set<ActivityFilter>(["all", "reports", "attention"]);

export async function GET(req: Request, ctx: RouteContext<"/api/guilds/[guildId]/activity">) {
  const session = await sessionFromRequest(req);
  if (!session) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const { guildId } = await ctx.params;
  try {
    await requireGuildAdmin(session.user.id, guildId);
  } catch (error) {
    if (error instanceof GuildAccessError)
      return Response.json({ error: "not_found" }, { status: 404 });
    throw error;
  }

  const url = new URL(req.url);
  const filterParam = url.searchParams.get("filter") as ActivityFilter | null;
  const before = url.searchParams.get("before");
  const beforeDate = before ? new Date(before) : undefined;

  const [activity, health] = await Promise.all([
    getActivity(guildId, {
      filter: filterParam && FILTERS.has(filterParam) ? filterParam : "all",
      before: beforeDate && !Number.isNaN(beforeDate.getTime()) ? beforeDate : undefined,
    }),
    deliveryHealth(guildId),
  ]);
  return Response.json({ ...activity, health }, { headers: { "cache-control": "no-store" } });
}
