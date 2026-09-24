import "server-only";
import { eq } from "drizzle-orm";
import { encrypt } from "../crypto";
import { db, type Tx } from "../db/client";
import { type Guild, guilds, interactions } from "../db/schema";
import { COMMAND_NAMES, type CommandName } from "../discord/commands";
import {
  actorOf,
  type Interaction,
  type InteractionResponse,
  InteractionType,
} from "../discord/types";
import { parseRule, type RuleSet } from "../guilds/rules";
import { log } from "../log";
import { ephemeral } from "./messages";
import { handleReportButton, handleReportCommand, handleReportModal } from "./report";
import { handleStatusCommand, handleStatusRefresh } from "./status";

export type InteractionResultCode =
  | "accepted"
  | "unconfigured_guild"
  | "command_disabled"
  | "forbidden"
  | "invalid";

export type HandlerResult = {
  result: InteractionResultCode;
  response: InteractionResponse;
  // True when jobs were enqueued that will need the interaction token for follow-ups.
  needsToken?: boolean;
};

export type Ctx = {
  tx: Tx;
  interaction: Interaction;
  guild: Guild;
  rules: RuleSet;
  actor: { id: string; name: string };
  now: Date;
};

export type HandleOutcome = {
  response: InteractionResponse;
  duplicate: boolean;
  result: InteractionResultCode;
};

const TOKEN_LIFETIME_MS = 15 * 60_000;

function interactionName(i: Interaction) {
  return i.data?.name ?? i.data?.custom_id ?? `type_${i.type}`;
}

function storedOptions(i: Interaction) {
  if (i.type === InteractionType.ApplicationCommand) return i.data?.options ?? null;
  if (i.type === InteractionType.ModalSubmit) return { components: i.data?.components ?? [] };
  return null;
}

async function loadContext(tx: Tx, i: Interaction) {
  if (!i.guild_id) return { guild: undefined, rules: undefined };
  const guild = await tx.query.guilds.findFirst({ where: eq(guilds.id, i.guild_id) });
  if (!guild || guild.disconnectedAt) return { guild: undefined, rules: undefined };
  const rows = await tx.query.commandRules.findMany({
    where: (r, { eq }) => eq(r.guildId, guild.id),
  });
  const row = (c: CommandName) => rows.find((r) => r.command === c);
  const rules: RuleSet = {
    report: parseRule("report", row("report")),
    status: parseRule("status", row("status")),
  };
  return { guild, rules };
}

async function dispatch(tx: Tx, i: Interaction, now: Date): Promise<HandlerResult> {
  const actor = actorOf(i);
  if (!i.guild_id || !actor) {
    return { result: "invalid", response: ephemeral("These commands only work inside a server.") };
  }

  const { guild, rules } = await loadContext(tx, i);
  if (!guild || !rules) {
    return {
      result: "unconfigured_guild",
      response: ephemeral(
        "This server isn't connected to Slash Bot yet. A server admin can connect it from the dashboard.",
      ),
    };
  }

  const ctx: Ctx = { tx, interaction: i, guild, rules, actor, now };
  const customId = i.data?.custom_id ?? "";

  switch (i.type) {
    case InteractionType.ApplicationCommand: {
      const name = i.data?.name as CommandName | undefined;
      if (!name || !COMMAND_NAMES.includes(name)) {
        return { result: "invalid", response: ephemeral("I don't know that command.") };
      }
      if (!rules[name].enabled) {
        return {
          result: "command_disabled",
          response: ephemeral(`/${name} is turned off on this server.`),
        };
      }
      return name === "report" ? handleReportCommand(ctx) : handleStatusCommand(ctx);
    }
    case InteractionType.ModalSubmit:
      if (customId.startsWith("report:modal")) {
        if (!rules.report.enabled) {
          return {
            result: "command_disabled",
            response: ephemeral("/report was turned off before you submitted. Nothing was filed."),
          };
        }
        return handleReportModal(ctx);
      }
      break;
    case InteractionType.MessageComponent:
      if (customId.startsWith("report:")) return handleReportButton(ctx);
      if (customId === "status:refresh") return handleStatusRefresh(ctx);
      break;
  }
  return { result: "invalid", response: ephemeral("That action isn't supported.") };
}

/**
 * Records and answers one verified interaction exactly once.
 *
 * The insert into `interactions` (primary key = Discord's interaction id) is the first
 * statement of the transaction. A concurrent duplicate blocks on that key until this
 * transaction commits, then gets nothing back from ON CONFLICT DO NOTHING and replays the
 * stored response. Jobs, reports and the response are written in the same transaction, so
 * either all side effects are recorded or none are.
 */
export async function handleInteraction(i: Interaction, now = new Date()): Promise<HandleOutcome> {
  const started = performance.now();
  const logger = log.child({ interactionId: i.id, guildId: i.guild_id, type: i.type });

  const outcome = await db().transaction(async (tx) => {
    const inserted = await tx
      .insert(interactions)
      .values({
        id: i.id,
        guildId: i.guild_id ?? null,
        channelId: i.channel_id ?? null,
        userId: actorOf(i)?.id ?? null,
        userName: actorOf(i)?.name ?? null,
        type: i.type,
        name: interactionName(i),
        options: storedOptions(i),
        result: "accepted",
        response: {},
        receivedAt: now,
      })
      .onConflictDoNothing({ target: interactions.id })
      .returning({ id: interactions.id });

    if (inserted.length === 0) return null;

    const handled = await dispatch(tx, i, now);
    await tx
      .update(interactions)
      .set({
        result: handled.result,
        response: handled.response,
        handleMs: Math.round(performance.now() - started),
        ...(handled.needsToken
          ? {
              tokenEncrypted: encrypt(i.token),
              tokenExpiresAt: new Date(now.getTime() + TOKEN_LIFETIME_MS),
            }
          : {}),
      })
      .where(eq(interactions.id, i.id));
    return handled;
  });

  if (!outcome) {
    const existing = await db().query.interactions.findFirst({
      where: eq(interactions.id, i.id),
      columns: { response: true, result: true },
    });
    logger.info("interaction.duplicate", { result: existing?.result });
    return {
      duplicate: true,
      result: existing?.result ?? "accepted",
      response: (existing?.response as InteractionResponse | undefined) ?? { type: 6 },
    };
  }

  logger.info("interaction.handled", {
    name: interactionName(i),
    result: outcome.result,
    durationMs: Math.round(performance.now() - started),
  });
  return { duplicate: false, result: outcome.result, response: outcome.response };
}
