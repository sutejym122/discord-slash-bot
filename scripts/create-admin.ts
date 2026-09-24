// Usage: pnpm admin:create <email> <password> [name]
import "dotenv/config";
import { upsertAdmin } from "@/server/admins";
import { closeDb } from "@/server/db/client";

const [email, password, name] = process.argv.slice(2);
if (!email || !password) {
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
