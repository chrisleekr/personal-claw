import { getLogger } from '@logtape/logtape';
import type { GuardrailsConfig } from '@personalclaw/shared';
import { nanoid } from 'nanoid';
import { maskPII } from '../../utils/pii-masker';
import type { CostTracker } from '../cost-tracker';
import { classifyWithLLM } from './classifier';
import { asInjectionCorpus, loadMergedCorpus, type MergedCorpus } from './corpus-loader';
import { scoreHeuristics } from './heuristics';
import { normalize } from './normalize';
import { similaritySearch } from './similarity';
import type { DetectionAction, DetectionContext, DetectionDecision, LayerResult } from './types';

const logger = getLogger(['personalclaw', 'guardrails', 'detection', 'engine']);

/**
 * FR-002 / FR-003 / FR-011 — Multi-layer injection detection engine.
 *
 * Orchestrates the 5 input-side layers in order:
 *
 * 1. normalize       — canonicalize Unicode / homoglyphs / zero-width / whitespace
 * 2. (structural)    — enforced at the caller via `wrapAsUntrusted()`; the engine
 *                      itself does not need to do structural work, but the
 *                      layer is counted in the audit trail for FR-002 compliance
 * 3. heuristics      — signal-based corpus matching
 * 4. similarity      — pgvector cosine similarity with two thresholds
 * 5. classifier      — LLM-based semantic classifier (skippable by short-circuit)
 *
 * Decision composition rules:
 *
 * - If any layer errors and the profile is `strict` → action = `block`
 *   (fail-closed per FR-011).
 * - If any layer errors and the profile is `balanced` or `permissive` →
 *   log a warning and proceed with the remaining layers (fail-open per FR-011).
 * - If the similarity layer short-circuits, skip the classifier and compose
 *   the decision from the layers that already ran.
 * - Final action is derived from the maximum risk score across fired layers:
 *   score >= 80 → block, 60 <= score < 80 → flag, 30 <= score < 60 → allow
 *   with non-zero score logged, < 30 → allow. The thresholds are module
 *   constants, not user config, to keep behavior predictable.
 *
 * Short-circuit variant: on layer error under permissive profile with no
 * fired layers, the engine returns `allow` (fail-open) but still records
 * the error in the audit trail per FR-017.
 */

const BLOCK_THRESHOLD = 80;
const FLAG_THRESHOLD = 60;
const LOG_ALLOW_THRESHOLD = 30;

/**
 * Default tuning knobs applied when a channel's `guardrailsConfig.detection`
 * is absent or partial. `classifierEnabled` is intentionally NOT in this
 * constant because its effective default is profile-dependent and computed
 * per-call in `detect()` via `resolveClassifierEnabled()` below.
 */
const DEFAULT_DETECTION_TUNING = {
  heuristicThreshold: 60,
  similarityThreshold: 0.85,
  similarityShortCircuitThreshold: 0.92,
  classifierTimeoutMs: 3000,
} as const;

type DefenseProfile = NonNullable<GuardrailsConfig['defenseProfile']>;

/**
 * Resolves the effective `classifierEnabled` setting for a detect() call,
 * applying the per-profile default when the channel config does not
 * explicitly set the field.
 *
 * Per-profile defaults (Phase 6 Option 2, locked 2026-04-10 — see
 * `spec.md` §SC-002 and `benchmark-results.md` §"Phase 6 decisions"):
 *
 *   - `strict`     → `true`  (LLM backstop for novel attacks; accepts the
 *                   9.6 % benign FP rate on local gemma4 as a known gap)
 *   - `balanced`   → `false` (fast path only; closes the SC-002 gap at
 *                   this profile and drops SC-003b latency ~23×)
 *   - `permissive` → `false` (fast path only)
 *
 * Explicit per-channel config (`config.detection?.classifierEnabled !==
 * undefined`) ALWAYS wins — operators can opt in on balanced or opt out
 * on strict if they accept the corresponding trade-off.
 */
function resolveClassifierEnabled(profile: DefenseProfile, explicit: boolean | undefined): boolean {
  if (explicit !== undefined) return explicit;
  return profile === 'strict';
}

/**
 * Detection decision plus the underlying per-layer results. The pipeline
 * stages consume `.decision` and forward `.layerResults` to the audit
 * writer so the full per-layer latency breakdown is persisted.
 */
export interface DetectionResult {
  decision: DetectionDecision;
  layerResults: readonly LayerResult[];
}

export class DetectionEngine {
  constructor(private readonly costTracker: CostTracker) {}

  async detect(
    text: string,
    context: DetectionContext,
    config: GuardrailsConfig,
  ): Promise<DetectionResult> {
    const profile: DefenseProfile = config.defenseProfile ?? 'balanced';
    // Compose the effective tuning: hard defaults, overlaid with any channel
    // config, with `classifierEnabled` resolved through the per-profile
    // default helper so "absent in config" means "strict: true, else false".
    const classifierEnabled = resolveClassifierEnabled(
      profile,
      config.detection?.classifierEnabled,
    );
    const tuning = {
      ...DEFAULT_DETECTION_TUNING,
      ...config.detection,
      classifierEnabled,
    };
    const layerResults: LayerResult[] = [];

    // Layer (a) — normalize
    const normResult = normalize(text);
    layerResults.push({
      layerId: 'normalize',
      fired: normResult.changed,
      score: normResult.changed ? 5 : 0, // Normalization itself is not a risk signal; tiny fingerprint score.
      reasonCode: normResult.changed ? 'NORMALIZED' : null,
      shortCircuit: false,
      latencyMs: 0, // normalize is <1ms; measured inside itself on hot paths only
    });

    // Layer (b) — structural separation is enforced at the caller (wrapAsUntrusted).
    // We record a no-op result so the audit trail reflects FR-002's 5-layer contract.
    layerResults.push({
      layerId: 'structural',
      fired: false,
      score: 0,
      reasonCode: null,
      shortCircuit: false,
      latencyMs: 0,
    });

    // Load the merged corpus (base + per-channel overrides).
    let mergedCorpus: MergedCorpus;
    try {
      mergedCorpus = await loadMergedCorpus(context.channelId);
    } catch (error) {
      return this.failureDecision(
        layerResults,
        profile,
        context,
        text,
        'unavailable',
        `corpus load: ${(error as Error).message}`,
      );
    }

    // Build the "input to score" — normalized current text plus the history window.
    const heuristicInput =
      context.recentHistory.length > 0
        ? [...context.recentHistory, normResult.normalized].join('\n')
        : normResult.normalized;

    // Layer (c) — heuristics
    const heuristicResult = scoreHeuristics(
      heuristicInput,
      asInjectionCorpus(mergedCorpus),
      tuning.heuristicThreshold,
    );
    layerResults.push(heuristicResult);
    if (heuristicResult.error) {
      return this.handleLayerError(
        heuristicResult.error.kind,
        profile,
        layerResults,
        context,
        text,
      );
    }

    // Layer (d) — pgvector similarity
    const similarityResult = await similaritySearch({
      normalizedText: normResult.normalized,
      channelId: context.channelId,
      allowlistedSignatureIds: mergedCorpus.suppressedIds,
      fireThreshold: tuning.similarityThreshold,
      shortCircuitThreshold: tuning.similarityShortCircuitThreshold,
    });
    layerResults.push(similarityResult);
    if (similarityResult.error) {
      if (profile === 'strict') {
        return this.failureDecision(
          layerResults,
          profile,
          context,
          text,
          similarityResult.error.kind,
          similarityResult.error.message,
        );
      }
      logger.warn('similarity layer failed (non-strict profile, proceeding)', {
        channelId: context.channelId,
        error: similarityResult.error.message,
      });
    }

    // Short-circuit path: if similarity says "strong match" skip the classifier.
    const shouldSkipClassifier = similarityResult.shortCircuit || !tuning.classifierEnabled;

    // Layer (e) — LLM classifier
    let classifierResult: LayerResult | null = null;
    if (!shouldSkipClassifier) {
      classifierResult = await classifyWithLLM({
        normalizedText: normResult.normalized,
        channelId: context.channelId,
        externalUserId: context.externalUserId,
        externalThreadId: context.threadId,
        timeoutMs: tuning.classifierTimeoutMs,
        costTracker: this.costTracker,
        recentHistory: context.recentHistory,
      });
      layerResults.push(classifierResult);
      if (classifierResult.error) {
        if (profile === 'strict') {
          return this.failureDecision(
            layerResults,
            profile,
            context,
            text,
            classifierResult.error.kind,
            classifierResult.error.message,
          );
        }
        logger.warn('classifier layer failed (non-strict profile, proceeding)', {
          channelId: context.channelId,
          errorKind: classifierResult.error.kind,
        });
      }
    }

    // Compose the final decision.
    return this.composeDecision(layerResults, profile, context, text);
  }

  /**
   * Builds a decision from the final layer results. Score composition is
   * the max across fired layers, with a small adjustment so "multiple
   * layers agree" raises the score slightly above any single layer alone.
   */
  private composeDecision(
    layerResults: readonly LayerResult[],
    profile: DefenseProfile,
    context: DetectionContext,
    rawText: string,
  ): DetectionResult {
    const firedLayers = layerResults.filter((l) => l.fired);
    const maxScore = firedLayers.reduce((m, l) => Math.max(m, l.score), 0);
    const agreementBonus = firedLayers.length >= 2 ? 10 : 0;
    const riskScore = Math.min(100, maxScore + agreementBonus);

    // Floor for permissive profile per FR-008: unambiguously malicious
    // payloads are still blocked. We approximate "unambiguous" as score >= 90.
    const effectiveBlockThreshold = profile === 'permissive' ? 90 : BLOCK_THRESHOLD;

    let action: DetectionAction;
    if (riskScore >= effectiveBlockThreshold) {
      action = 'block';
    } else if (riskScore >= FLAG_THRESHOLD && profile !== 'permissive') {
      action = 'flag';
    } else if (riskScore >= LOG_ALLOW_THRESHOLD) {
      action = 'allow'; // logged because score is non-zero
    } else {
      action = 'allow';
    }

    const firedIds = firedLayers.map((l) => l.layerId);
    const reasonCode = firedLayers[0]?.reasonCode ?? (action === 'allow' ? 'NO_MATCH' : 'COMPOSED');

    return {
      decision: {
        action,
        riskScore,
        layersFired: firedIds,
        reasonCode,
        redactedExcerpt: maskPII(rawText).slice(0, 500),
        referenceId: nanoid(12),
        sourceKind: context.sourceKind,
      },
      layerResults,
    };
  }

  /**
   * Fail-closed / fail-open decision per FR-011 when a layer errors at a
   * point where strict profiles cannot safely continue.
   */
  private failureDecision(
    layerResults: readonly LayerResult[],
    profile: DefenseProfile,
    context: DetectionContext,
    rawText: string,
    errorKind: 'timeout' | 'unavailable' | 'internal',
    errorMessage: string,
  ): DetectionResult {
    if (profile === 'strict') {
      return {
        decision: {
          action: 'block',
          riskScore: 100,
          layersFired: layerResults.filter((l) => l.fired).map((l) => l.layerId),
          reasonCode: `FAIL_CLOSED:${errorKind}`,
          redactedExcerpt: maskPII(rawText).slice(0, 500),
          referenceId: nanoid(12),
          sourceKind: context.sourceKind,
        },
        layerResults,
      };
    }
    // Non-strict: fail open but record the error.
    logger.warn('Detection layer failed (non-strict profile, proceeding allow)', {
      channelId: context.channelId,
      errorKind,
      errorMessage,
    });
    return this.composeDecision(layerResults, profile, context, rawText);
  }

  private handleLayerError(
    errorKind: 'timeout' | 'unavailable' | 'internal',
    profile: DefenseProfile,
    layerResults: readonly LayerResult[],
    context: DetectionContext,
    rawText: string,
  ): DetectionResult {
    return this.failureDecision(layerResults, profile, context, rawText, errorKind, '');
  }
}

/**
 * Convenience factory used by the pipeline stages — they pass the shared
 * `CostTracker` from the agent engine's top-level deps.
 */
export function createDetectionEngine(costTracker: CostTracker): DetectionEngine {
  return new DetectionEngine(costTracker);
}

/**
 * Re-export for ergonomic imports.
 */
export type { DetectionContext, DetectionDecision, LayerResult, SourceKind } from './types';
