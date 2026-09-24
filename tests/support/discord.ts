import { createPrivateKey, sign } from "node:crypto";

let counter = 0n;

// Snowflake-shaped ids that are unique per test run.
export function snowflake() {
  counter += 1n;
  return (1_200_000_000_000_000_000n + BigInt(Date.now()) * 1000n + counter).toString();
}

export function signBody(body: string, timestamp = Math.floor(Date.now() / 1000).toString()) {
  const key = createPrivateKey(process.env.TEST_DISCORD_PRIVATE_KEY as string);
  const signature = sign(null, Buffer.from(timestamp + body), key).toString("hex");
  return { signature, timestamp };
}

export function signedRequest(
  payload: unknown,
  opts: { timestamp?: string; tamper?: boolean; headers?: Record<string, string> } = {},
) {
  const body = JSON.stringify(payload);
  const { signature, timestamp } = signBody(body, opts.timestamp);
  return new Request("http://localhost:3000/api/discord/interactions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": signature,
      "x-signature-timestamp": timestamp,
      ...opts.headers,
    },
    body: opts.tamper ? body.replace("}", ',"x":1}') : body,
  });
}

type Base = { guildId?: string; userId?: string; permissions?: string; id?: string };

function base(o: Base) {
  return {
    id: o.id ?? snowflake(),
    application_id: process.env.DISCORD_APPLICATION_ID,
    token: `interaction-token-${snowflake()}`,
    version: 1,
    guild_id: o.guildId,
    channel_id: "300000000000000001",
    member: {
      user: { id: o.userId ?? "400000000000000001", username: "alice", global_name: "Alice" },
      permissions: o.permissions ?? "0",
    },
  };
}

export const ping = () => ({ ...base({}), type: 1, guild_id: undefined, member: undefined });

export function command(name: string, options: Record<string, string> = {}, o: Base = {}) {
  return {
    ...base(o),
    type: 2,
    data: {
      id: "500000000000000001",
      name,
      type: 1,
      options: Object.entries(options).map(([k, v]) => ({ name: k, type: 3, value: v })),
    },
  };
}

export function modalSubmit(values: Record<string, string>, o: Base = {}) {
  return {
    ...base(o),
    type: 5,
    data: {
      custom_id: "report:modal",
      components: Object.entries(values).map(([k, v]) =>
        ["severity", "category"].includes(k)
          ? { type: 18, component: { type: 3, custom_id: k, values: [v] } }
          : { type: 18, component: { type: 4, custom_id: k, value: v } },
      ),
    },
  };
}

export function button(customId: string, o: Base = {}) {
  return {
    ...base(o),
    type: 3,
    data: { custom_id: customId, component_type: 2 },
    message: { id: "600000000000000001" },
  };
}
