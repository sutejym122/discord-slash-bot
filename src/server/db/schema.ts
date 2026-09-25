import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () =>
  ts("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// Auth tables. Shape is dictated by Better Auth; property names must match its models.

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("accounts_user_idx").on(t.userId)],
);

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const rateLimits = pgTable("rate_limits", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

// Product tables.

export const mirrorKind = pgEnum("mirror_kind", ["slack", "discord"]);

export const guilds = pgTable("guilds", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  icon: text("icon"),
  alertChannelId: text("alert_channel_id"),
  alertChannelName: text("alert_channel_name"),
  mirrorKind: mirrorKind("mirror_kind"),
  // Webhook URLs are bearer credentials: stored encrypted, only the hint ever leaves the server.
  mirrorUrlEncrypted: text("mirror_url_encrypted"),
  mirrorUrlHint: text("mirror_url_hint"),
  // Testing tool: while set in the future, mirror deliveries fail as if the webhook returned 503.
  mirrorOutageUntil: ts("mirror_outage_until"),
  reportCount: integer("report_count").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  disconnectedAt: ts("disconnected_at"),
});

// The owner is whoever installed the bot through the dashboard. Owners can share access and
// disconnect the server; admins they add can do everything else.
export const adminRole = pgEnum("admin_role", ["owner", "admin"]);

export const guildAdmins = pgTable(
  "guild_admins",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: adminRole("role").notNull().default("admin"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.guildId, t.userId] }),
    index("guild_admins_user_idx").on(t.userId),
  ],
);

export const commandRules = pgTable(
  "command_rules",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    command: text("command").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    settings: jsonb("settings").notNull().default({}),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.command] })],
);

export const interactionResult = pgEnum("interaction_result", [
  "accepted",
  "unconfigured_guild",
  "command_disabled",
  "forbidden",
  "invalid",
]);

// The primary key is Discord's interaction id, which makes this table the dedupe ledger.
// guild_id is deliberately not a foreign key: interactions from servers that were never
// connected are still recorded.
export const interactions = pgTable(
  "interactions",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id"),
    channelId: text("channel_id"),
    userId: text("user_id"),
    userName: text("user_name"),
    type: smallint("type").notNull(),
    name: text("name").notNull(),
    options: jsonb("options"),
    result: interactionResult("result").notNull(),
    response: jsonb("response").notNull(),
    // Interaction tokens can post as the app for 15 minutes, so they are encrypted and
    // cleared once no job needs them.
    tokenEncrypted: text("token_encrypted"),
    tokenExpiresAt: ts("token_expires_at"),
    handleMs: integer("handle_ms"),
    receivedAt: ts("received_at").notNull().defaultNow(),
  },
  (t) => [index("interactions_guild_received_idx").on(t.guildId, t.receivedAt.desc())],
);

export const reportSeverity = pgEnum("report_severity", ["low", "medium", "high", "critical"]);
export const reportStatus = pgEnum("report_status", ["open", "acknowledged", "resolved"]);
export const aiStatus = pgEnum("ai_status", ["pending", "done", "skipped", "failed"]);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    interactionId: text("interaction_id")
      .notNull()
      .unique()
      .references(() => interactions.id),
    channelId: text("channel_id"),
    reporterId: text("reporter_id").notNull(),
    reporterName: text("reporter_name").notNull(),
    title: text("title").notNull(),
    details: text("details").notNull(),
    category: text("category").notNull(),
    severity: reportSeverity("severity").notNull(),
    status: reportStatus("status").notNull().default("open"),
    statusChangedBy: text("status_changed_by"),
    statusChangedAt: ts("status_changed_at"),
    aiStatus: aiStatus("ai_status").notNull(),
    aiSummary: text("ai_summary"),
    aiCategory: text("ai_category"),
    aiSeverity: reportSeverity("ai_severity"),
    aiTags: text("ai_tags").array(),
    aiNextStep: text("ai_next_step"),
    aiError: text("ai_error"),
    alertChannelId: text("alert_channel_id"),
    alertMessageId: text("alert_message_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("reports_guild_number_idx").on(t.guildId, t.number),
    index("reports_guild_created_idx").on(t.guildId, t.createdAt.desc()),
  ],
);

export const jobKind = pgEnum("job_kind", ["triage", "reply", "channel_post", "mirror"]);
export const jobStatus = pgEnum("job_status", [
  "pending",
  "running",
  "retrying",
  "succeeded",
  "failed",
]);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    interactionId: text("interaction_id")
      .notNull()
      .references(() => interactions.id),
    reportId: uuid("report_id").references(() => reports.id, {
      onDelete: "cascade",
    }),
    kind: jobKind("kind").notNull(),
    status: jobStatus("status").notNull().default("pending"),
    payload: jsonb("payload").notNull().default({}),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull(),
    runAt: ts("run_at").notNull().defaultNow(),
    lockedUntil: ts("locked_until"),
    lastError: text("last_error"),
    lastErrorCode: text("last_error_code"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    finishedAt: ts("finished_at"),
  },
  (t) => [
    // One job of each kind per interaction: a redelivered interaction or a re-run of the
    // step that enqueues follow-up work can never create a second side effect.
    uniqueIndex("jobs_interaction_kind_idx").on(t.interactionId, t.kind),
    index("jobs_due_idx").on(t.runAt).where(sql`${t.status} in ('pending', 'retrying', 'running')`),
    index("jobs_guild_created_idx").on(t.guildId, t.createdAt.desc()),
  ],
);

export const attemptOutcome = pgEnum("attempt_outcome", [
  "succeeded",
  "retryable_error",
  "permanent_error",
]);

export const jobAttempts = pgTable(
  "job_attempts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    outcome: attemptOutcome("outcome").notNull(),
    httpStatus: integer("http_status"),
    error: text("error"),
    durationMs: integer("duration_ms").notNull(),
    startedAt: ts("started_at").notNull(),
  },
  (t) => [uniqueIndex("job_attempts_job_attempt_idx").on(t.jobId, t.attempt)],
);

// Last run of periodic work (the minute sweep), so a scheduler that silently stopped calling
// us shows up in /api/health and the dashboard instead of going unnoticed.
export const heartbeats = pgTable("heartbeats", {
  name: text("name").primaryKey(),
  lastRunAt: ts("last_run_at").notNull(),
  detail: jsonb("detail").notNull().default({}),
});

export type Guild = typeof guilds.$inferSelect;
export type AdminRole = (typeof adminRole.enumValues)[number];
export type Interaction = typeof interactions.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type JobKind = (typeof jobKind.enumValues)[number];
export type Severity = (typeof reportSeverity.enumValues)[number];
