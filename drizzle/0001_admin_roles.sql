CREATE TYPE "public"."admin_role" AS ENUM('owner', 'admin');--> statement-breakpoint
ALTER TABLE "guild_admins" ADD COLUMN "role" "admin_role" DEFAULT 'admin' NOT NULL;--> statement-breakpoint
-- Everyone with access before this migration got it by installing the bot, so they are owners.
UPDATE "guild_admins" SET "role" = 'owner';
