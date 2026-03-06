ALTER TABLE "sessions" DROP CONSTRAINT "sessions_pkey";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_session_token_unique";--> statement-breakpoint
ALTER TABLE "sessions" ADD PRIMARY KEY ("session_token");--> statement-breakpoint
ALTER TABLE "channels" ALTER COLUMN "memory_config" SET DEFAULT '{"maxMemories":200,"injectTopN":10}'::jsonb;