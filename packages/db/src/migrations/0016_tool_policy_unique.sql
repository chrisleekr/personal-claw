-- Dedupe any existing duplicate tool_policies rows before adding unique indexes.
-- For each (mcp_config_id, channel_id) pair (treating NULL channel_id as a
-- distinct group), keep the most recently created row and delete the rest.
-- This is required because the upsert path (mcp.service.ts upsertToolPolicy)
-- previously did SELECT-then-INSERT/UPDATE without DB-level uniqueness, so two
-- concurrent callers could each insert a row.
DELETE FROM "tool_policies" t
USING "tool_policies" t2
WHERE t.id <> t2.id
  AND t.mcp_config_id = t2.mcp_config_id
  AND (
    (t.channel_id IS NOT NULL AND t2.channel_id IS NOT NULL AND t.channel_id = t2.channel_id)
    OR (t.channel_id IS NULL AND t2.channel_id IS NULL)
  )
  AND t.created_at < t2.created_at;
--> statement-breakpoint
-- Postgres treats NULL as distinct in standard unique constraints, so we use
-- two partial unique indexes: one for non-null channel_id (per-channel policy)
-- and one for null channel_id (global policy).
CREATE UNIQUE INDEX "tool_policies_mcp_config_channel_unique"
  ON "tool_policies" ("mcp_config_id", "channel_id")
  WHERE "channel_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "tool_policies_mcp_config_global_unique"
  ON "tool_policies" ("mcp_config_id")
  WHERE "channel_id" IS NULL;
