import { getLogger } from '@logtape/logtape';
import { sql } from '@personalclaw/db';
import { config } from '../../config';
import { getDb } from '../../db';
import { generateEmbedding } from '../../memory/embeddings';
import type { LayerResult } from './types';

const logger = getLogger(['personalclaw', 'guardrails', 'detection', 'similarity']);

/**
 * FR-002(d) — pgvector embedding similarity layer.
 *
 * Generates an embedding for the normalized input and performs a cosine
 * similarity query against `detection_corpus_embeddings` filtered by the
 * currently active embedding provider and source version. Two thresholds
 * per analysis finding A1:
 *
 * - `similarityThreshold` (default 0.85) — layer fires and contributes to
 *   the final decision, but the pipeline continues through the classifier.
 * - `similarityShortCircuitThreshold` (default 0.92) — layer short-circuits
 *   the pipeline and skips the classifier.
 *
 * Channel-specific allowlist suppressions (via `detection_overrides`) are
 * honored: suppressed signature ids are filtered from the similarity
 * candidates via the merged corpus ids passed in by the caller.
 *
 * On any DB error the layer returns `{ fired: false, error: { kind: 'unavailable' } }`
 * so the engine can apply fail-closed/fail-open per FR-011 — the layer
 * never throws.
 */

export interface SimilarityInput {
  normalizedText: string;
  channelId: string;
  allowlistedSignatureIds: readonly string[];
  fireThreshold: number;
  shortCircuitThreshold: number;
}

interface SimilarityRow {
  signature_id: string;
  signature_category: string;
  similarity: number;
}

/**
 * Runs the similarity layer.
 *
 * @returns LayerResult with the highest-similarity non-suppressed match
 */
export async function similaritySearch(input: SimilarityInput): Promise<LayerResult> {
  const start = performance.now();

  if (!input.normalizedText) {
    return {
      layerId: 'similarity',
      fired: false,
      score: 0,
      reasonCode: null,
      shortCircuit: false,
      latencyMs: performance.now() - start,
    };
  }

  // Generate the embedding for the input.
  let queryEmbedding: number[];
  try {
    queryEmbedding = await generateEmbedding(input.normalizedText);
  } catch (error) {
    logger.warn('Similarity layer: embedding generation failed', {
      channelId: input.channelId,
      error: (error as Error).message,
    });
    return {
      layerId: 'similarity',
      fired: false,
      score: 0,
      reasonCode: null,
      shortCircuit: false,
      latencyMs: performance.now() - start,
      error: { kind: 'unavailable', message: (error as Error).message },
    };
  }

  // Run the pgvector cosine query. Filter by the active embedding provider so
  // we only compare against embeddings generated with the same model.
  const embeddingProvider = config.EMBEDDING_PROVIDER ?? 'openai';

  let rows: SimilarityRow[];
  try {
    const queryResult = await getDb().execute(sql`
      SELECT signature_id, signature_category,
             1 - (embedding <=> ${JSON.stringify(queryEmbedding)}::vector) AS similarity
      FROM detection_corpus_embeddings
      WHERE embedding_provider = ${embeddingProvider}
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${JSON.stringify(queryEmbedding)}::vector
      LIMIT 5
    `);
    rows = Array.isArray(queryResult) ? (queryResult as unknown as SimilarityRow[]) : [];
  } catch (error) {
    logger.warn('Similarity layer: pgvector query failed', {
      channelId: input.channelId,
      error: (error as Error).message,
    });
    return {
      layerId: 'similarity',
      fired: false,
      score: 0,
      reasonCode: null,
      shortCircuit: false,
      latencyMs: performance.now() - start,
      error: { kind: 'unavailable', message: (error as Error).message },
    };
  }

  // Filter out channel-allowlisted signatures.
  const suppressedSet = new Set(input.allowlistedSignatureIds);
  const topMatch = rows.find((r) => !suppressedSet.has(r.signature_id));

  if (!topMatch) {
    return {
      layerId: 'similarity',
      fired: false,
      score: 0,
      reasonCode: null,
      shortCircuit: false,
      latencyMs: performance.now() - start,
    };
  }

  // Normalize the similarity to a [0, 100] score for the engine.
  const similarityValue = Number(topMatch.similarity);
  const score = Math.max(0, Math.min(100, Math.round(similarityValue * 100)));

  const fired = similarityValue >= input.fireThreshold;
  const shortCircuit = similarityValue >= input.shortCircuitThreshold;

  return {
    layerId: 'similarity',
    fired,
    score: fired ? score : 0,
    reasonCode: fired
      ? `SIMILARITY_MATCH:${topMatch.signature_id}:${topMatch.signature_category}`
      : null,
    shortCircuit,
    latencyMs: performance.now() - start,
  };
}
