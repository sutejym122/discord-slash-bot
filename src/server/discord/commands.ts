export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const CATEGORIES = ["bug", "incident", "abuse", "question", "other"] as const;

export type Category = (typeof CATEGORIES)[number];

const OptionType = { String: 3 } as const;
const GUILD_ONLY = { contexts: [0], integration_types: [0] };

const choices = (values: readonly string[]) =>
  values.map((v) => ({ name: v[0].toUpperCase() + v.slice(1), value: v }));

// Registered with a bulk overwrite (PUT), so this list is the full source of truth.
export const commandDefinitions = [
  {
    name: "report",
    description: "Report a problem to the moderators",
    type: 1,
    ...GUILD_ONLY,
    options: [
      {
        name: "details",
        description: "What happened? Leave empty to open a form instead.",
        type: OptionType.String,
        required: false,
        max_length: 1500,
      },
      {
        name: "severity",
        description: "How urgent is it?",
        type: OptionType.String,
        required: false,
        choices: choices(SEVERITIES),
      },
      {
        name: "category",
        description: "What kind of problem is it?",
        type: OptionType.String,
        required: false,
        choices: choices(CATEGORIES),
      },
    ],
  },
  {
    name: "status",
    description: "Show how the bot is set up here and what it has been doing",
    type: 1,
    ...GUILD_ONLY,
  },
] as const;

export type CommandName = (typeof commandDefinitions)[number]["name"];
export const COMMAND_NAMES = commandDefinitions.map((c) => c.name) as CommandName[];
