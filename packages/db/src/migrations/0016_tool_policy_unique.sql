-- Deduplicate any existing duplicate rows on (mcp_config_id, channel_id),
-- keeping the most recently created row per group. Postgres groups NULLs
-- together inside PARTITION BY, so this also dedupes global (channel_id IS
-- NULL) duplicates.
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY "mcp_config_id", "channel_id"
      ORDER BY "created_at" DESC, "id" DESC
    ) AS rn
  FROM "tool_policies"
)
DELETE FROM "tool_policies"
WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1);
--> statement-breakpoint
-- Partial unique index for channel-scoped policies (channel_id NOT NULL).
-- Standard unique constraints can't span a nullable column safely because
-- Postgres treats NULLs as distinct in unique comparisons.
CREATE UNIQUE INDEX IF NOT EXISTS "tool_policies_mcp_channel_unique"
  ON "tool_policies" ("mcp_config_id", "channel_id")
  WHERE "channel_id" IS NOT NULL;
--> statement-breakpoint
-- Partial unique index for global policies (channel_id IS NULL): one global
-- policy row per mcp_config_id.
CREATE UNIQUE INDEX IF NOT EXISTS "tool_policies_mcp_channel_null_unique"
  ON "tool_policies" ("mcp_config_id")
  WHERE "channel_id" IS NULL;
