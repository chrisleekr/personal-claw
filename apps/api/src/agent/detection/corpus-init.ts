import { getLogger } from '@logtape/logtape';
import { and, detectionCorpusEmbeddings, eq, sql } from '@personalclaw/db';
import { loadAdversarialCorpus } from '@personalclaw/shared';
import { config } from '../../config';
import { getDb } from '../../db';
import { generateEmbedding } from '../../memory/embeddings';

const logger = getLogger(['personalclaw', 'guardrails', 'detection', 'corpus-init']);

/**
 * Research.md R5 — API process startup: populate
 * `detection_corpus_embeddings` from the committed base corpus.
 *
 * For each signature in `signatures.json`, check whether a row exists for
 * the tuple `(signature_id, embedding_provider, source_version)`. If not,
 * generate the embedding via the existing `generateEmbedding()` helper
 * and upsert. Subsequent boots with an unchanged corpus and unchanged
 * provider are no-ops.
 *
 * Per research.md R10: any failure during corpus init is FATAL — the
 * process exits via a thrown error because a detection pipeline without
 * its base corpus is a silent security weakening.
 */
export async function initDetectionCorpus(): Promise<void> {
  const corpus = loadAdversarialCorpus();
  const embeddingProvider = config.EMBEDDING_PROVIDER ?? 'openai';
  const sourceVersion = corpus.schemaVersion;

  logger.info('Initializing detection corpus embeddings', {
    totalSignatures: corpus.signatures.length,
    embeddingProvider,
    sourceVersion,
  });

  const db = getDb();
  let generated = 0;
  let skipped = 0;

  for (const sig of corpus.signatures) {
    // Check existence for the current tuple.
    const existing = await db
      .select({ id: detectionCorpusEmbeddings.id })
      .from(detectionCorpusEmbeddings)
      .where(
        and(
          eq(detectionCorpusEmbeddings.signatureId, sig.id),
          eq(detectionCorpusEmbeddings.embeddingProvider, embeddingProvider),
          eq(detectionCorpusEmbeddings.sourceVersion, sourceVersion),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      skipped++;
      continue;
    }

    // Generate the embedding and upsert.
    const embedding = await generateEmbedding(sig.text);

    await db.execute(sql`
      INSERT INTO detection_corpus_embeddings
        (signature_id, signature_text, signature_category, embedding_provider, source_version, embedding, created_at)
      VALUES (
        ${sig.id},
        ${sig.text},
        ${sig.category},
        ${embeddingProvider},
        ${sourceVersion},
        ${JSON.stringify(embedding)}::vector,
        now()
      )
      ON CONFLICT (signature_id, embedding_provider, source_version) DO NOTHING
    `);
    generated++;
  }

  logger.info('Detection corpus init complete', {
    generated,
    skipped,
    totalSignatures: corpus.signatures.length,
    embeddingProvider,
    sourceVersion,
  });
}
