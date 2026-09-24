import { z } from "zod";
import { type CommandName, SEVERITIES } from "../discord/commands";

const severity = z.enum(SEVERITIES);
const roleId = z
  .string()
  .regex(/^\d{17,20}$/, "Role ID should be the 17 to 20 digit number from Discord")
  .nullable();

export const reportSettingsSchema = z.object({
  aiTriage: z.boolean().default(true),
  // Which severity decides routing: what the reporter picked, or the higher of that and the AI's.
  severitySource: z.enum(["reporter", "higher_of_both"]).default("higher_of_both"),
  // null means never.
  alertMinSeverity: severity.nullable().default("low"),
  mirrorMinSeverity: severity.nullable().default("medium"),
  pingRoleId: roleId.default(null),
  pingMinSeverity: severity.default("high"),
});

export const statusSettingsSchema = z.object({
  visibility: z.enum(["private", "public"]).default("private"),
  mirror: z.boolean().default(false),
});

export type ReportSettings = z.infer<typeof reportSettingsSchema>;
export type StatusSettings = z.infer<typeof statusSettingsSchema>;

export const settingsSchemas = {
  report: reportSettingsSchema,
  status: statusSettingsSchema,
} satisfies Record<CommandName, z.ZodType>;

export type Rule<C extends CommandName> = {
  command: C;
  enabled: boolean;
  settings: z.infer<(typeof settingsSchemas)[C]>;
};

export type RuleSet = { report: Rule<"report">; status: Rule<"status"> };

// Stored settings are parsed with defaults on every read, so adding a setting later never
// needs a data migration and a bad row can't crash the interaction path.
export function parseRule<C extends CommandName>(
  command: C,
  row: { enabled: boolean; settings: unknown } | undefined,
): Rule<C> {
  const schema = settingsSchemas[command];
  const parsed = schema.safeParse(row?.settings ?? {});
  return {
    command,
    enabled: row?.enabled ?? true,
    settings: (parsed.success ? parsed.data : schema.parse({})) as Rule<C>["settings"],
  };
}

export function severityRank(s: (typeof SEVERITIES)[number]) {
  return SEVERITIES.indexOf(s);
}

export function meetsSeverity(
  actual: (typeof SEVERITIES)[number],
  min: (typeof SEVERITIES)[number] | null,
) {
  return min !== null && severityRank(actual) >= severityRank(min);
}
