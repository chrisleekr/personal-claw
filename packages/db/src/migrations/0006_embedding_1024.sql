-- Fix: migration 0002 was tracked but columns were never created.
-- Add embedding (1024-dim for Titan V2 / OpenAI shortened) and search_vector columns.

ALTER TABLE "channel_memories" ADD COLUMN IF NOT EXISTS "embedding" vector(1024);

ALTER TABLE "channel_memories" ADD COLUMN IF NOT EXISTS "search_vector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED;

DROP INDEX IF EXISTS "channel_memories_embedding_idx";
CREATE INDEX "channel_memories_embedding_idx"
  ON "channel_memories" USING hnsw ("embedding" vector_cosine_ops);

DROP INDEX IF EXISTS "channel_memories_search_vector_idx";
CREATE INDEX "channel_memories_search_vector_idx"
  ON "channel_memories" USING gin ("search_vector");
