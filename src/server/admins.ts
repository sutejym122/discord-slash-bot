import "server-only";
import { eq } from "drizzle-orm";
import { auth } from "./auth";
import { db } from "./db/client";
import { users } from "./db/schema";

// Sign-up is disabled on the public API, so admin accounts are created through Better Auth's
// internal adapter. Running it again for an existing email resets the password.
export async function upsertAdmin(email: string, password: string, name?: string) {
  if (password.length < 10) throw new Error("Password must be at least 10 characters");
  const ctx = await auth().$context;
  const normalised = email.trim().toLowerCase();
  const hash = await ctx.password.hash(password);
  const existing = await db().query.users.findFirst({ where: eq(users.email, normalised) });

  if (existing) {
    await ctx.internalAdapter.updatePassword(existing.id, hash);
    return { user: existing, created: false };
  }
  const user = await ctx.internalAdapter.createUser(
    { email: normalised, name: name ?? normalised.split("@")[0], emailVerified: true },
    { method: "admin" },
  );
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: hash,
  });
  return { user, created: true };
}
