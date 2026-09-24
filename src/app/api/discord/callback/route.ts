import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { env } from "@/server/env";
import { completeInstall, INSTALL_STATE_COOKIE, statesMatch } from "@/server/guilds/install";
import { JobError } from "@/server/jobs/errors";
import { log } from "@/server/log";
import { sessionFromRequest } from "@/server/session";

function back(path: string) {
  return NextResponse.redirect(new URL(path, env().APP_URL));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const session = await sessionFromRequest(req);
  if (!session) return back("/login");

  const jar = await cookies();
  const expected = jar.get(INSTALL_STATE_COOKIE)?.value;
  jar.delete({ name: INSTALL_STATE_COOKIE, path: "/api/discord/callback" });

  if (url.searchParams.get("error")) return back("/dashboard?install=cancelled");
  const code = url.searchParams.get("code");
  if (!code || !statesMatch(expected, url.searchParams.get("state"))) {
    log.warn("install.rejected", { reason: "state_mismatch", userId: session.user.id });
    return back("/dashboard?install=expired");
  }

  try {
    const guildId = await completeInstall(session.user.id, code);
    log.info("install.completed", { guildId, userId: session.user.id });
    return back(`/dashboard/${guildId}/settings?connected=1`);
  } catch (error) {
    log.error("install.failed", {
      userId: session.user.id,
      code: error instanceof JobError ? error.code : "unexpected",
      error,
    });
    return back("/dashboard?install=failed");
  }
}
