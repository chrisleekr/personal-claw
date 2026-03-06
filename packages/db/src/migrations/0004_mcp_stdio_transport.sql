ALTER TABLE "mcp_configs" ALTER COLUMN "server_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_configs" ADD COLUMN "command" text;--> statement-breakpoint
ALTER TABLE "mcp_configs" ADD COLUMN "args" jsonb;--> statement-breakpoint
ALTER TABLE "mcp_configs" ADD COLUMN "env" jsonb;--> statement-breakpoint
ALTER TABLE "mcp_configs" ADD COLUMN "cwd" text;