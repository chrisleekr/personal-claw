import { describe, expect, mock, test } from 'bun:test';
import { loadAdversarialCorpus } from '@personalclaw/shared';

/**
 * T083 — Corpus enforcement test (CI mock mode).
 *
 * Gates SC-001 (≥95% adversarial blocked or neutralized at strict profile)
 * and SC-002 (≤3% false-positive rate on benign corpus at strict profile)
 * via the *full* DetectionEngine.detect() pipeline, but with three
 * deterministic in-process mocks substituted for the layers that would
 * otherwise need network or filesystem services CI does not have:
 *
 *   1. `corpus-loader` → returns the real committed corpus from
 *      `@personalclaw/shared` (no DB query for per-channel overrides).
 *   2. `similarity`    → substring oracle. Fires `shortCircuit: true` when
 *      the normalized input contains any committed adversarial signature
 *      as a substring; otherwise returns `fired: false`. This stands in for
 *      pgvector cosine similarity without needing the database.
 *   3. `classifier`    → no-op. Always returns `fired: false`. This proves
 *      the assertions hold even when the slow LLM layer contributes nothing,
 *      which mirrors the deployment reality of `--skip-classifier` mode.
 *
 * Why these specific mocks? See the analysis in `benchmark-results.md`
 * Run #1 (2026-04-10): the live benchmark showed 100% of adversarial
 * inputs short-circuit at the similarity layer because each committed
 * signature matches its own embedding by exact identity. The substring
 * oracle here approximates that "matches itself" property without the
 * embedding HTTP roundtrip and pgvector query, while still validating the
 * full engine compose path (normalize → structural → heuristics →
 * similarity → classifier).
 *
 * The companion test file `corpus-enforcement-live.test.ts` runs the same
 * SC-001/SC-002 assertions against the *real* DB and *real* Ollama
 * classifier and is gated by `BENCHMARK_MODE=live` so it never runs in CI.
 *
 * Spec anchors:
 * - SC-001 / SC-002: adversarial block rate ≥95%, FP rate ≤3% at strict
 * - FR-009: representative benign corpus FP target
 * - tasks.md T083 — this test (resolves analysis finding U2)
 */

// ---------------------------------------------------------------------------
// Mocks — installed BEFORE the engine import so the test isolation runner's
// per-file subprocess picks up the mocked modules when `engine.ts` resolves
// its imports. The detection-test pattern (see `engine.test.ts`) is to put
// `mock.module()` calls at the top of the file before any value imports of
// the engine. The Bun test transformer hoists `mock.module()` so this works
// even though ESM imports are syntactically hoisted above.
// ---------------------------------------------------------------------------

mock.module('../corpus-loader', () => ({
  loadMergedCorpus: async () => {
    const adv = loadAdversarialCorpus();
    return {
      schemaVersion: adv.schemaVersion,
      signatures: adv.signatures,
      suppressedIds: [],
    };
  },
  asInjectionCorpus: (m: { schemaVersion: string; signatures: unknown[] }) => ({
    schemaVersion: m.schemaVersion,
    signatures: m.signatures,
  }),
}));

mock.module('../similarity', () => ({
  similaritySearch: async ({ normalizedText }: { normalizedText: string }) => {
    const adv = loadAdversarialCorpus();
    const lowered = normalizedText.toLowerCase();
    for (const sig of adv.signatures) {
      const needle = sig.text.toLowerCase();
      if (needle.length > 0 && lowered.includes(needle)) {
        return {
          layerId: 'similarity' as const,
          fired: true,
          score: 95,
          reasonCode: `SIMILARITY_MOCK_MATCH:${sig.id}`,
          shortCircuit: true,
          latencyMs: 1,
        };
      }
    }
    return {
      layerId: 'similarity' as const,
      fired: false,
      score: 0,
      reasonCode: null,
      shortCircuit: false,
      latencyMs: 1,
    };
  },
}));

mock.module('../classifier', () => ({
  classifyWithLLM: async () => ({
    layerId: 'classifier' as const,
    fired: false,
    score: 0,
    reasonCode: null,
    shortCircuit: false,
    latencyMs: 0,
  }),
}));

import { DetectionEngine } from '../engine';
import {
  buildConfig,
  NoOpCostTracker,
  runAdversarialCorpus,
  runBenignCorpus,
} from './corpus-enforcement-helpers';

describe('T083 — corpus enforcement (CI mock mode)', () => {
  const engine = new DetectionEngine(new NoOpCostTracker());

  // Both profiles are exercised here with an EXPLICIT `classifierEnabled`
  // to keep the test independent of the per-profile default resolver logic
  // (that's covered by `engine.test.ts`'s "per-profile classifierEnabled
  // default" suite). The mock-mode assertions below gate the engine's
  // compose logic + the substring-oracle similarity stand-in against the
  // committed corpus in both profile modes. Classifier is mocked to a
  // no-op everywhere so the test's outcome depends only on layers a-d.

  describe('strict profile', () => {
    const config = buildConfig({ profile: 'strict', classifierEnabled: true });

    test('SC-001 — adversarial corpus blocked or neutralized rate ≥ 95%', async () => {
      const result = await runAdversarialCorpus(engine, config);

      if (result.blockRate < 0.95) {
        // Surface the missed ids in the failure message so a regression is debuggable.
        throw new Error(
          `SC-001 violation: blockRate=${(result.blockRate * 100).toFixed(1)}% ` +
            `(${result.blockedOrNeutralized}/${result.total}). ` +
            `Missed signature ids: ${result.missedReferenceIds.join(', ')}`,
        );
      }

      expect(result.blockedOrNeutralized).toBeGreaterThanOrEqual(Math.ceil(0.95 * result.total));
      expect(result.blockRate).toBeGreaterThanOrEqual(0.95);
    });

    test('SC-002 — benign corpus false-positive rate ≤ 3%', async () => {
      const result = await runBenignCorpus(engine, config);

      if (result.falsePositiveRate > 0.03) {
        throw new Error(
          `SC-002 violation: falsePositiveRate=${(result.falsePositiveRate * 100).toFixed(1)}% ` +
            `(${result.falsePositives}/${result.total}). ` +
            `Over-blocked benign ids: ${result.missedReferenceIds.join(', ')}`,
        );
      }

      expect(result.falsePositives).toBeLessThanOrEqual(Math.floor(0.03 * result.total));
      expect(result.falsePositiveRate).toBeLessThanOrEqual(0.03);
    });
  });

  describe('balanced profile (Phase 6 Option 2: classifier disabled by default)', () => {
    // Explicit classifierEnabled: false to mirror the per-profile default
    // applied by `resolveClassifierEnabled()` at runtime.
    const config = buildConfig({ profile: 'balanced', classifierEnabled: false });

    test('SC-001 — adversarial corpus blocked or neutralized rate ≥ 95% (fast path only)', async () => {
      const result = await runAdversarialCorpus(engine, config);

      if (result.blockRate < 0.95) {
        throw new Error(
          `SC-001 balanced violation: blockRate=${(result.blockRate * 100).toFixed(1)}% ` +
            `(${result.blockedOrNeutralized}/${result.total}). ` +
            `Missed signature ids: ${result.missedReferenceIds.join(', ')}. ` +
            `Note: balanced profile has the classifier disabled by default; the fast path ` +
            `(similarity + heuristics) alone must catch the corpus.`,
        );
      }

      expect(result.blockedOrNeutralized).toBeGreaterThanOrEqual(Math.ceil(0.95 * result.total));
      expect(result.blockRate).toBeGreaterThanOrEqual(0.95);
    });

    test('SC-002 — benign corpus false-positive rate ≤ 3% (closes the gap vs strict+classifier)', async () => {
      const result = await runBenignCorpus(engine, config);

      if (result.falsePositiveRate > 0.03) {
        throw new Error(
          `SC-002 balanced violation: falsePositiveRate=${(result.falsePositiveRate * 100).toFixed(1)}% ` +
            `(${result.falsePositives}/${result.total}). ` +
            `Over-blocked benign ids: ${result.missedReferenceIds.join(', ')}. ` +
            `Balanced profile should trivially meet SC-002 because the classifier ` +
            `is disabled and the similarity/heuristics layers do not fire on benign inputs.`,
        );
      }

      expect(result.falsePositives).toBeLessThanOrEqual(Math.floor(0.03 * result.total));
      expect(result.falsePositiveRate).toBeLessThanOrEqual(0.03);
    });
  });
});
