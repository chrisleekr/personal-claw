import type { InjectionCorpus, InjectionSignature } from '@personalclaw/shared';
import type { LayerResult } from './types';

/**
 * FR-002(c) — Signal-based heuristic scoring layer.
 *
 * Produces a layer-level risk score by combining two signals:
 *
 * 1. **Substring / phrase presence** against the committed attack corpus.
 *    For each signature whose (case-insensitive) text appears as a substring
 *    of the normalized input, add a score contribution weighted by the
 *    signature's severity. This catches exact and near-exact matches cheaply.
 *
 * 2. **Per-category density**. If multiple signatures from the same category
 *    match, apply a category-multiplier to reflect that the input is
 *    thematically saturated with that attack class.
 *
 * The layer operates on normalized text (output of `normalize()`). It does
 * not call any external service and runs in <1 ms for typical inputs.
 *
 * Severity weights are deliberate constants, not runtime configuration:
 * operators tune the overall threshold via `detection.heuristicThreshold`
 * (default 60) in the guardrails config. Changing the per-severity weights
 * requires a PR review.
 */

const SEVERITY_WEIGHT: Record<InjectionSignature['severity'], number> = {
  low: 15,
  medium: 30,
  high: 50,
  critical: 80,
};

const CATEGORY_DENSITY_BONUS = 15;

/**
 * Scores a single input against the committed corpus. Returns a
 * `LayerResult` with `layerId: 'heuristics'`, `fired: true` when the score
 * meets or exceeds the threshold, and `shortCircuit: false` (heuristics
 * never ends the pipeline early — it always feeds into the similarity and
 * classifier layers).
 *
 * @param normalizedText Canonical output of `normalize()`
 * @param corpus Committed adversarial corpus
 * @param threshold Fire threshold from `config.detection.heuristicThreshold`
 * @returns Layer result with score, reasonCode, and matched signature ids in the reasonCode tail
 */
export function scoreHeuristics(
  normalizedText: string,
  corpus: InjectionCorpus,
  threshold: number,
): LayerResult {
  const start = performance.now();
  if (!normalizedText) {
    return {
      layerId: 'heuristics',
      fired: false,
      score: 0,
      reasonCode: null,
      shortCircuit: false,
      latencyMs: performance.now() - start,
    };
  }

  const matchedSignatures: string[] = [];
  const categoriesHit: Map<string, number> = new Map();
  let scoreSum = 0;

  for (const sig of corpus.signatures) {
    const needle = sig.text.toLowerCase();
    if (needle.length === 0) continue;
    if (normalizedText.includes(needle)) {
      matchedSignatures.push(sig.id);
      scoreSum += SEVERITY_WEIGHT[sig.severity];
      categoriesHit.set(sig.category, (categoriesHit.get(sig.category) ?? 0) + 1);
    }
  }

  // Category density bonus: +CATEGORY_DENSITY_BONUS for each category with 2+ hits
  for (const count of categoriesHit.values()) {
    if (count >= 2) scoreSum += CATEGORY_DENSITY_BONUS;
  }

  // Cap at 100 — risk score is bounded in [0, 100].
  const score = Math.min(100, scoreSum);
  const fired = score >= threshold;

  const reasonCode = fired ? `HEURISTIC_MATCH:${matchedSignatures.slice(0, 5).join(',')}` : null;

  return {
    layerId: 'heuristics',
    fired,
    score,
    reasonCode,
    shortCircuit: false,
    latencyMs: performance.now() - start,
  };
}
