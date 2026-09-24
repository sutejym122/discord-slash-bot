// Registers /report and /status globally with a bulk overwrite. Safe to run on every deploy:
// Discord only treats it as a change when the definitions differ.
import "dotenv/config";
import { commandDefinitions } from "@/server/discord/commands";
import { overwriteGlobalCommands } from "@/server/discord/rest";

// Preview deployments share the bot with production, so only production builds register.
const vercelEnv = process.env.VERCEL_ENV;
if (process.env.SKIP_COMMAND_SYNC === "1" || (vercelEnv && vercelEnv !== "production")) {
  console.log("Skipping command registration");
  process.exit(0);
}

try {
  const registered = await overwriteGlobalCommands(commandDefinitions);
  console.log(`Registered commands: ${registered.map((c) => `/${c.name}`).join(", ")}`);
} catch (error) {
  console.error("Command registration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
