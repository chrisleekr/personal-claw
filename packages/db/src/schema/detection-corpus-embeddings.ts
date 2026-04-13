// pgvector `embedding vector(1024)` column + HNSW index added via raw SQL in
// migration 0015 (same pattern as migration 0006 for `channel_memories`).
import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

/**
 * Cached 1024-dimension embeddings for the committed base attack corpus at
 * `packages/shared/src/injection-corpus/signatures.json`.
 *
 * This table is **global**, not channel-scoped — the base corpus is a shared
 * resource per FR-032. Channel isolation (Constitution III) does not apply
 * here because there is no per-channel data; the detection pipeline reads
 * these rows identically for every channel.
 *
 * Populated at API process startup by `initDetectionCorpus()` in
 * `apps/api/src/agent/detection/corpus-init.ts` per research.md R5:
 *
 * 1. Parse the committed `signatures.json`
 * 2. For each signature, check if `(signature_id, embedding_provider, source_version)`
 *    already has a row
 * 3. If missing, call `generateEmbedding()` (from apps/api/src/memory/embeddings.ts)
 *    and upsert
 *
 * Any failure during startup generation causes a FATAL log and process exit
 * per research.md R10 — a detection pipeline without its base corpus is a
 * silent security weakening.
 *
 * Per-provider rows exist because switching `EMBEDDING_PROVIDER` regenerates
 * embeddings for the new provider without deleting the old ones (rollback
 * safety). Queries at detect-time filter by the currently-active provider.
 */
export const detectionCorpusEmbeddings = pgTable(
  'detection_corpus_embeddings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    signatureId: text('signature_id').notNull(),
    signatureText: text('signature_text').notNull(),
    signatureCategory: text('signature_category').notNull(),
    embeddingProvider: text('embedding_provider').notNull(),
    // `embedding vector(1024)` column is created via raw SQL in migration 0015
    sourceVersion: text('source_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('detection_corpus_embeddings_sig_provider_version_unique').on(
      table.signatureId,
      table.embeddingProvider,
      table.sourceVersion,
    ),
    index('detection_corpus_embeddings_signature_idx').on(table.signatureId),
  ],
);
