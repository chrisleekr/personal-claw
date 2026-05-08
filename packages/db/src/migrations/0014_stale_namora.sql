ALTER TABLE "channels" ADD COLUMN "approval_timeout_ms" integer DEFAULT 600000 NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "channel_admins" text[] DEFAULT '{}' NOT NULL;