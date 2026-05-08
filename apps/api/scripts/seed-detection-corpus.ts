#!/usr/bin/env bun
/**
 * Seed entry point for the detection-corpus embeddings table.
 *
 * Wraps `initDetectionCorpus()` so the dev DB can be primed in a single
 * deliberate step (`bun run apps/api/scripts/seed-detection-corpus.ts`)
 * instead of folding the embedding-generation cost into every benchmark
 * or test run that depends on the corpus being populated.
 *
 * Why this exists:
 *
 * `apps/api/src/agent/detection/corpus-init.ts` already implements an
 * idempotent loader that, on first run for a given
 * `(embedding_provider, source_version)` tuple, generates ~52 embeddings
 * via the configured embedding provider and inserts them into
 * `detection_corpus_embeddings`. That call takes 1–2 minutes against a
 * local Ollama embedding model, which is far too slow to absorb into
 * the benchmark script (`benchmark-detection.ts`) or any unit test.
 *
 * This script is intentionally a thin wrapper:
 *   - It exits 0 if all rows already exist (no-op idempotent behavior).
 *   - It exits 0 after generating any missing rows.
 *   - It exits 1 with a clear error if `DATABASE_URL` or the embedding
 *     provider is unreachable.
 *
 * Usage:
 *
 *   bun run apps/api/scripts/seed-detection-corpus.ts
 *
 * Run this once after applying migration 0015 (which creates the
 * `detection_corpus_embeddings` table) and after every change to the
 * committed `signatures.json` schemaVersion. Subsequent runs are no-ops.
 *
 * Spec anchors:
 *   - FR-032: committed adversarial corpus, runtime-immutable
 *   - research.md §R5: corpus embedding cache strategy at startup
 *   - research.md §R10: fail-closed boot if corpus init crashes
 *   - tasks.md T050 (initDetectionCorpus implementation, this is its CLI peer)
 */

import { initDetectionCorpus } from '../src/agent/detection/corpus-init';

try {
  const startedAt = performance.now();
  await initDetectionCorpus();
  const elapsedSec = ((performance.now() - startedAt) / 1000).toFixed(2);
  process.stdout.write(`Detection corpus seed complete in ${elapsedSec} s\n`);
  process.exit(0);
} catch (error) {
  process.stderr.write(
    `Detection corpus seed failed: ${(error as Error).message}\n` +
      'Verify DATABASE_URL and the configured embedding provider are reachable, then retry.\n',
  );
  process.exit(1);
}
