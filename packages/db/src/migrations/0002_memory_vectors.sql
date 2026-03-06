-- Enable pgvector extension for semantic similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column for pgvector cosine similarity search
ALTER TABLE "channel_memories" ADD COLUMN "embedding" vector(1536);

-- Add generated tsvector column for full-text keyword search
ALTER TABLE "channel_memories" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED;

-- Create IVFFlat index for fast approximate nearest-neighbor search
CREATE INDEX "channel_memories_embedding_idx"
  ON "channel_memories" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

-- Create GIN index for fast full-text search
CREATE INDEX "channel_memories_search_vector_idx"
  ON "channel_memories" USING gin ("search_vector");
