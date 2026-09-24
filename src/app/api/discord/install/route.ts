import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { env } from "@/server/env";
import { INSTALL_STATE_COOKIE, installUrl, newInstallState } from "@/server/guilds/install";
import { sessionFromRequest } from "@/server/session";

export async function GET(req: Request) {
  const session = await sessionFromRequest(req);
  if (!session) return NextResponse.redirect(new URL("/login", env().APP_URL));

  // CSRF protection for the OAuth round trip: the callback must present the same value.
  const state = newInstallState();
  (await cookies()).set(INSTALL_STATE_COOKIE, state, {
    httpOnly: true,
    secure: env().APP_URL.startsWith("https://"),
    sameSite: "lax",
    path: "/api/discord/callback",
    maxAge: 600,
  });
  return NextResponse.redirect(installUrl(state));
}
