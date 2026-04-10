import type { GuardrailsConfig } from '@personalclaw/shared';
import { loadAdversarialCorpus, loadBenignCorpus } from '@personalclaw/shared';
import { CostTracker } from '../../cost-tracker';
import type { DetectionEngine } from '../engine';
import type { DetectionContext } from '../types';

/**
 * Shared helpers for the T083 corpus-enforcement test pair (mock mode and
 * live mode). Exported separately so the two `*.test.ts` files in this
 * directory can share corpus-walking logic, config defaults, and a no-op
 * cost tracker without duplicating code.
 *
 * IMPORTANT — load order: this file imports `CostTracker` (a runtime class)
 * but uses `import type` for `DetectionEngine` and `DetectionContext`. The
 * type-only imports do not trigger module loading at test time, which keeps
 * the call chain `helpers → engine → similarity/classifier/corpus-loader`
 * from forcing those modules to load before the mock-mode test file has
 * had a chance to install its `mock.module()` overrides.
 *
 * Spec anchors:
 * - SC-001: ≥95% adversarial blocked or neutralized at strict profile
 * - SC-002: ≤3% false-positive rate on benign corpus at strict profile
 * - tasks.md T083
 */

const NIL_CHANNEL = '00000000-0000-0000-0000-000000000000';
const NIL_USER = 'corpus-enforcement-test-user';
const NIL_THREAD = 'corpus-enforcement-test-thread';

/**
 * No-op cost tracker for tests. Subclasses the real `CostTracker` so the
 * `DetectionEngine` constructor accepts it directly without `as unknown as`
 * casts, while shadowing `log()` to a no-op so test runs do not pollute the
 * `usage_logs` table.
 */
export class NoOpCostTracker extends CostTracker {
  async log(): Promise<void> {
    // Intentionally empty — see class JSDoc.
  }
}

/**
 * Builds a guardrails config tuned for the corpus-enforcement assertions.
 *
 * The `profile` parameter lets callers test per-profile behavior:
 *
 *   - `strict`   — full defense-in-depth; the spec gate for SC-001/SC-002
 *   - `balanced` — fast path only by default (classifier disabled per the
 *                  Phase 6 Option 2 default); SC-002 trivially closes here
 *   - `permissive` — same as balanced plus the FR-008 block floor
 *
 * The `classifierEnabled` parameter is OPTIONAL so tests can either exercise
 * the per-profile default (omit it) or opt explicitly into/out of the
 * classifier (pass a boolean). Most mock-mode tests set an explicit value
 * so the test's behavior is independent of the default resolver logic;
 * the engine-level default tests live in `engine.test.ts` instead.
 */
export function buildConfig(opts: {
  profile: 'strict' | 'balanced' | 'permissive';
  classifierEnabled?: boolean;
}): GuardrailsConfig {
  return {
    preProcessing: {
      contentFiltering: true,
      intentClassification: false,
      maxInputLength: 10_000,
    },
    postProcessing: {
      piiRedaction: false,
      outputValidation: false,
    },
    defenseProfile: opts.profile,
    canaryTokenEnabled: false,
    auditRetentionDays: 7,
    detection: {
      heuristicThreshold: 60,
      similarityThreshold: 0.85,
      similarityShortCircuitThreshold: 0.92,
      classifierEnabled: opts.classifierEnabled,
      classifierTimeoutMs: 3_000,
    },
  };
}

/**
 * Backward-compatible alias for the pre-Phase-6 helper name. New code
 * should call `buildConfig({ profile: 'strict', classifierEnabled: ... })`
 * directly.
 *
 * @deprecated Use `buildConfig` with an explicit profile.
 */
export function buildStrictConfig(opts: { classifierEnabled: boolean }): GuardrailsConfig {
  return buildConfig({ profile: 'strict', classifierEnabled: opts.classifierEnabled });
}

/**
 * Returns a fresh detection context for each test invocation. The channel
 * id is the all-zero UUID so per-channel override lookups in the real
 * corpus-loader return zero rows (no FK violation, no test pollution).
 */
export function buildContext(): DetectionContext {
  return {
    channelId: NIL_CHANNEL,
    externalUserId: NIL_USER,
    threadId: NIL_THREAD,
    sourceKind: 'user_message',
    recentHistory: [],
  };
}

/**
 * Result of running an entire corpus through `engine.detect()`.
 * `blockedOrNeutralized` counts the strict-profile actions that prevent
 * the content from reaching the LLM (`block`) or rewrite it inside an
 * untrusted marker (`neutralize`). `flag` and `allow` are NOT counted as
 * blocked because they let the original content through to the model.
 */
export interface CorpusRunResult {
  total: number;
  blockedOrNeutralized: number;
  blockRate: number;
  /** Reference ids of inputs that were NOT blocked, useful for debugging a regression. */
  missedReferenceIds: string[];
}

/**
 * Runs every entry in `loadAdversarialCorpus()` through `engine.detect()`
 * and returns the aggregate block rate. Failures are recorded in
 * `missedReferenceIds` so a debugger can see which signature ids slipped
 * through when the suite reports a regression.
 */
export async function runAdversarialCorpus(
  engine: DetectionEngine,
  config: GuardrailsConfig,
): Promise<CorpusRunResult> {
  const corpus = loadAdversarialCorpus();
  const ctx = buildContext();
  let blockedOrNeutralized = 0;
  const missedReferenceIds: string[] = [];

  for (const sig of corpus.signatures) {
    const result = await engine.detect(sig.text, ctx, config);
    const action = result.decision.action;
    if (action === 'block' || action === 'neutralize') {
      blockedOrNeutralized++;
    } else {
      missedReferenceIds.push(sig.id);
    }
  }

  return {
    total: corpus.signatures.length,
    blockedOrNeutralized,
    blockRate: blockedOrNeutralized / corpus.signatures.length,
    missedReferenceIds,
  };
}

/**
 * Runs every entry in `loadBenignCorpus()` through `engine.detect()` and
 * returns the aggregate false-positive rate. Same `missedReferenceIds`
 * pattern as `runAdversarialCorpus`, but here a "miss" is a false-positive
 * block — the test reports which benign sample was over-blocked so the
 * corpus or thresholds can be tuned.
 */
export async function runBenignCorpus(
  engine: DetectionEngine,
  config: GuardrailsConfig,
): Promise<{
  total: number;
  falsePositives: number;
  falsePositiveRate: number;
  missedReferenceIds: string[];
}> {
  const corpus = loadBenignCorpus();
  const ctx = buildContext();
  let falsePositives = 0;
  const missedReferenceIds: string[] = [];

  for (const sample of corpus.samples) {
    const result = await engine.detect(sample.text, ctx, config);
    const action = result.decision.action;
    if (action === 'block' || action === 'neutralize') {
      falsePositives++;
      missedReferenceIds.push(sample.id);
    }
  }

  return {
    total: corpus.samples.length,
    falsePositives,
    falsePositiveRate: falsePositives / corpus.samples.length,
    missedReferenceIds,
  };
}
