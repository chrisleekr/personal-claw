-- Dedupe any existing duplicate conversations rows before adding the unique
-- constraint. For each (channel_id, external_thread_id) pair, keep the most
-- recently updated row and delete the rest. This is required because the
-- previous append path (conversation.ts ConversationMemory.append) did
-- SELECT-then-INSERT without DB-level uniqueness, so two concurrent callers
-- could each insert a row for the same thread.
DELETE FROM "conversations" c
USING "conversations" c2
WHERE c.id <> c2.id
  AND c.channel_id = c2.channel_id
  AND c.external_thread_id = c2.external_thread_id
  AND c.updated_at < c2.updated_at;
--> statement-breakpoint
ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_channel_thread_unique"
  UNIQUE ("channel_id", "external_thread_id");
