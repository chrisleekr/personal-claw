-- Rename Slack-specific columns to platform-agnostic names
ALTER TABLE "channels" RENAME COLUMN "slack_channel_id" TO "external_id";--> statement-breakpoint
ALTER TABLE "channels" RENAME COLUMN "slack_channel_name" TO "external_name";--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "platform" text DEFAULT 'slack' NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" DROP CONSTRAINT "channels_slack_channel_id_unique";--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_platform_external_id_idx" UNIQUE("platform","external_id");--> statement-breakpoint
ALTER TABLE "conversations" RENAME COLUMN "slack_thread_ts" TO "external_thread_id";--> statement-breakpoint
DROP INDEX "conversations_channel_thread_idx";--> statement-breakpoint
CREATE INDEX "conversations_channel_thread_idx" ON "conversations" USING btree ("channel_id","external_thread_id");--> statement-breakpoint
ALTER TABLE "usage_logs" RENAME COLUMN "slack_user_id" TO "external_user_id";--> statement-breakpoint
ALTER TABLE "usage_logs" RENAME COLUMN "slack_thread_ts" TO "external_thread_id";--> statement-breakpoint
DROP INDEX "usage_logs_user_created_idx";--> statement-breakpoint
CREATE INDEX "usage_logs_user_created_idx" ON "usage_logs" USING btree ("external_user_id","created_at");--> statement-breakpoint
ALTER TABLE "channel_memories" RENAME COLUMN "source_thread_ts" TO "source_thread_id";
