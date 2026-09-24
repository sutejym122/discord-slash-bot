// Sends a signed interaction to a running local server, the same way Discord would.
// Needs LOCAL_DISCORD_PRIVATE_KEY in .env (the pair of DISCORD_PUBLIC_KEY), so it only works
// against a local setup, never against the real Discord app.
//
//   pnpm simulate report <guildId> "Spam bot in #general" [severity]
//   pnpm simulate status <guildId>
//   pnpm simulate ping
import "dotenv/config";
import { createPrivateKey, randomInt, sign } from "node:crypto";

const [kind = "ping", guildId, text, severity = "medium"] = process.argv.slice(2);
const key = process.env.LOCAL_DISCORD_PRIVATE_KEY;
if (!key) {
  console.error("LOCAL_DISCORD_PRIVATE_KEY is not set. See README > Running without Discord.");
  process.exit(1);
}

const snowflake = () =>
  ((BigInt(Date.now() - 1420070400000) << 22n) | BigInt(randomInt(1 << 22))).toString();
const base = {
  id: snowflake(),
  application_id: process.env.DISCORD_APPLICATION_ID,
  token: `local-${snowflake()}`,
  version: 1,
  guild_id: guildId,
  channel_id: "100000000000000002",
  member: {
    user: { id: "100000000000000003", username: "local-tester", global_name: "Local Tester" },
    permissions: String(1 << 13),
  },
};

const payload =
  kind === "ping"
    ? { ...base, type: 1, guild_id: undefined, member: undefined }
    : kind === "status"
      ? { ...base, type: 2, data: { id: "1", name: "status", type: 1 } }
      : {
          ...base,
          type: 2,
          data: {
            id: "1",
            name: "report",
            type: 1,
            options: [
              { name: "details", type: 3, value: text ?? "Test report from the simulator" },
              { name: "severity", type: 3, value: severity },
            ],
          },
        };

const body = JSON.stringify(payload);
const timestamp = Math.floor(Date.now() / 1000).toString();
const privateKey = createPrivateKey({
  key: Buffer.from(key, "base64"),
  format: "der",
  type: "pkcs8",
});
const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString("hex");

const res = await fetch(`${process.env.APP_URL}/api/discord/interactions`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-signature-ed25519": signature,
    "x-signature-timestamp": timestamp,
  },
  body,
});
console.log(res.status, JSON.stringify(await res.json(), null, 2));
