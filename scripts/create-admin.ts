// Creates an admin account, or resets its password if it exists.
//
//   pnpm admin:create <email> <password> [name]
//
// With --from-env it reads ADMIN_EMAIL / ADMIN_PASSWORD instead and does nothing when they're
// unset. The Vercel build runs it that way, so the first admin can be created without a local
// copy of the production database URL.
import "dotenv/config";
import { upsertAdmin } from "@/server/admins";
import { closeDb } from "@/server/db/client";

const args = process.argv.slice(2);
const fromEnv = args.includes("--from-env");
const [email, password, name] = fromEnv
  ? [process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, undefined]
  : args;

if (!email || !password) {
  if (fromEnv) {
    console.log("ADMIN_EMAIL / ADMIN_PASSWORD not set, skipping admin setup");
    process.exit(0);
  }
  console.error("Usage: pnpm admin:create <email> <password> [name]");
  process.exit(1);
}

try {
  const { created } = await upsertAdmin(email, password, name);
  console.log(created ? `Created admin ${email}` : `Reset password for ${email}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
