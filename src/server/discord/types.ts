import { z } from "zod";

export const InteractionType = {
  Ping: 1,
  ApplicationCommand: 2,
  MessageComponent: 3,
  ApplicationCommandAutocomplete: 4,
  ModalSubmit: 5,
} as const;

export const ResponseType = {
  Pong: 1,
  ChannelMessage: 4,
  DeferredChannelMessage: 5,
  DeferredUpdateMessage: 6,
  UpdateMessage: 7,
  Modal: 9,
} as const;

export const MessageFlags = { Ephemeral: 1 << 6 } as const;

export const Permission = {
  Administrator: 1n << 3n,
  ManageGuild: 1n << 5n,
  ManageMessages: 1n << 13n,
  ViewChannel: 1n << 10n,
  SendMessages: 1n << 11n,
  EmbedLinks: 1n << 14n,
} as const;

const snowflake = z.string().regex(/^\d{15,21}$/);

const user = z.object({
  id: snowflake,
  username: z.string(),
  global_name: z.string().nullish(),
});

const commandOption = z.object({
  name: z.string(),
  type: z.number(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

const modalComponent: z.ZodType<ModalComponent> = z.lazy(() =>
  z.object({
    type: z.number(),
    custom_id: z.string().optional(),
    value: z.string().optional(),
    values: z.array(z.string()).optional(),
    component: modalComponent.optional(),
    components: z.array(modalComponent).optional(),
  }),
);
export type ModalComponent = {
  type: number;
  custom_id?: string;
  value?: string;
  values?: string[];
  component?: ModalComponent;
  components?: ModalComponent[];
};

// Only the fields we use are validated; Discord adds fields over time and zod strips unknown
// keys rather than rejecting them.
export const interactionSchema = z.object({
  id: snowflake,
  application_id: snowflake,
  type: z.number().int(),
  token: z.string().min(1).max(1000),
  version: z.number().optional(),
  guild_id: snowflake.optional(),
  channel_id: snowflake.optional(),
  member: z
    .object({
      user,
      permissions: z.string().regex(/^\d+$/),
      nick: z.string().nullish(),
    })
    .optional(),
  user: user.optional(),
  data: z
    .object({
      name: z.string().optional(),
      custom_id: z.string().max(100).optional(),
      component_type: z.number().optional(),
      options: z.array(commandOption).optional(),
      components: z.array(modalComponent).optional(),
    })
    .optional(),
  message: z.object({ id: snowflake }).optional(),
});

export type Interaction = z.infer<typeof interactionSchema>;

export type InteractionResponse = {
  type: number;
  data?: Record<string, unknown>;
};

export function actorOf(i: Interaction) {
  const u = i.member?.user ?? i.user;
  return u ? { id: u.id, name: i.member?.nick || u.global_name || u.username } : undefined;
}

export function hasPermission(i: Interaction, permission: bigint) {
  if (!i.member) return false;
  const bits = BigInt(i.member.permissions);
  return (bits & Permission.Administrator) !== 0n || (bits & permission) !== 0n;
}

export function optionValue(i: Interaction, name: string) {
  return i.data?.options?.find((o) => o.name === name)?.value;
}

export function modalValues(i: Interaction): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (components: ModalComponent[] | undefined) => {
    for (const c of components ?? []) {
      if (c.custom_id && typeof c.value === "string") out[c.custom_id] = c.value;
      if (c.custom_id && c.values?.[0]) out[c.custom_id] = c.values[0];
      if (c.component) walk([c.component]);
      walk(c.components);
    }
  };
  walk(i.data?.components);
  return out;
}
