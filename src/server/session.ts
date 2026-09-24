import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";

export async function getSession() {
  return auth().api.getSession({ headers: await headers() });
}

// For pages and server actions. Route handlers use `sessionFromRequest` and return 401 instead.
export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session.user;
}

export async function sessionFromRequest(req: Request) {
  return auth().api.getSession({ headers: req.headers });
}
