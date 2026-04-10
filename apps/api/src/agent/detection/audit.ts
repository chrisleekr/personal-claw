import { getLogger } from '@logtape/logtape';
import { detectionAuditEvents } from '@personalclaw/db';
import { getDb } from '../../db';
import { HooksEngine } from '../../hooks/engine';
import { maskPII } from '../../utils/pii-masker';
import type { DetectionDecision, LayerResult } from './types';

const logger = getLogger(['personalclaw', 'guardrails', 'detection', 'audit']);

/**
 * FR-026 / FR-027 — Persists a detection decision to the
 * `detection_audit_events` table (authoritative system of record) and
 * emits the `guardrail:detection` hook as a best-effort side-channel.
 *
 * Per FR-027: the DB write MUST succeed before the hook is emitted.
 * A hook-handler failure is NOT an audit failure because the row is
 * already on disk.
 *
 * Per FR-010: the redacted excerpt passes through `maskPII()` before insert.
 * Per Constitution III: every insert is scoped by channelId.
 */

const EXCERPT_MAX_LEN = 500;

export interface WriteAuditEventInput {
  decision: DetectionDecision;
  layerResults: readonly LayerResult[];
  channelId: string;
  externalUserId: string;
  threadId: string | null;
  rawExcerpt: string;
  canaryHit: boolean;
}

/**
 * Writes a single audit event. Does not throw on hook-emission failures;
 * does throw on DB insert failures so the pipeline can react.
 */
export async function writeAuditEvent(input: WriteAuditEventInput): Promise<void> {
  const { decision, layerResults, channelId, externalUserId, threadId, rawExcerpt, canaryHit } =
    input;

  // Redact PII and truncate to the column bound.
  const masked = maskPII(rawExcerpt);
  const redactedExcerpt =
    masked.length > EXCERPT_MAX_LEN ? `${masked.slice(0, EXCERPT_MAX_LEN - 1)}…` : masked;

  try {
    await getDb()
      .insert(detectionAuditEvents)
      .values({
        channelId,
        externalUserId,
        threadId,
        decision: decision.action,
        riskScore: decision.riskScore.toFixed(2),
        layersFired: decision.layersFired,
        reasonCode: decision.reasonCode,
        redactedExcerpt,
        referenceId: decision.referenceId,
        sourceKind: decision.sourceKind,
        canaryHit,
      });
  } catch (error) {
    logger.error('Failed to persist detection_audit_events row', {
      channelId,
      referenceId: decision.referenceId,
      decision: decision.action,
      error: (error as Error).message,
    });
    throw error;
  }

  // Best-effort side-channel hook emission per FR-027.
  try {
    const hookResult = await HooksEngine.getInstance().emit('guardrail:detection', {
      channelId,
      externalUserId,
      threadId: threadId ?? '',
      eventType: 'guardrail:detection',
      payload: {
        action: decision.action,
        riskScore: decision.riskScore,
        layersFired: decision.layersFired,
        reasonCode: decision.reasonCode,
        referenceId: decision.referenceId,
        sourceKind: decision.sourceKind,
        canaryHit,
        layerResults: layerResults.map((l) => ({
          layerId: l.layerId,
          fired: l.fired,
          score: l.score,
          reasonCode: l.reasonCode,
          latencyMs: l.latencyMs,
          errorKind: l.error?.kind ?? null,
        })),
      },
    });
    if (hookResult.errors.length > 0) {
      // Hook handler failures are logged but do not propagate — the audit row is already durable.
      logger.warn('guardrail:detection hook handler(s) failed; audit row still persisted', {
        channelId,
        referenceId: decision.referenceId,
        handlerErrorCount: hookResult.errors.length,
      });
    }
  } catch (hookError) {
    logger.warn('guardrail:detection hook emission threw', {
      channelId,
      referenceId: decision.referenceId,
      error: (hookError as Error).message,
    });
  }
}
