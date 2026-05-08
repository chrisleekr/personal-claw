-- Deduplicate any existing duplicate rows on (channel_id, external_thread_id),
-- keeping the most recently updated row per group.
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY "channel_id", "external_thread_id"
      ORDER BY "updated_at" DESC, "id" DESC
    ) AS rn
  FROM "conversations"
)
DELETE FROM "conversations"
WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1);
--> statement-breakpoint
-- Replace the existing non-unique index with a unique constraint. Both
-- columns are NOT NULL, so a standard unique constraint is sufficient. The
-- unique constraint creates its own backing btree index, making the prior
-- non-unique one redundant.
DROP INDEX IF EXISTS "conversations_channel_thread_idx";
--> statement-breakpoint
-- Postgres has no `ADD CONSTRAINT IF NOT EXISTS`, so wrap in a DO block that
-- swallows the duplicate_object error to keep this migration idempotent
-- alongside the `IF NOT EXISTS` guards used elsewhere (e.g. migration 0016).
DO $$ BEGIN
  ALTER TABLE "conversations"
    ADD CONSTRAINT "conversations_channel_thread_unique"
    UNIQUE ("channel_id", "external_thread_id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;
