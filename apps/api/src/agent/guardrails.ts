import { getLogger } from '@logtape/logtape';
import { and, approvalPolicies, eq, ne } from '@personalclaw/db';
import { type GuardrailsConfig, guardrailsConfigSchema } from '@personalclaw/shared';
import { getCachedConfig } from '../channels/config-cache';
import { getDb } from '../db';
import { errorDetails } from '../utils/error-fmt';
import { maskPII } from '../utils/pii-masker';
import type { CostTracker } from './cost-tracker';
import { writeAuditEvent } from './detection/audit';
import { checkResponseForCanary, generateCanary, injectCanary } from './detection/canary';
import { createDetectionEngine, type DetectionEngine } from './detection/engine';
import type {
  CanaryToken,
  DetectionContext,
  DetectionDecision,
  LayerResult,
} from './detection/types';

const logger = getLogger(['personalclaw', 'guardrails']);

/**
 * Legacy default config kept for backward compatibility — per FR-023 the
 * `GuardrailsEngine` derives a `defenseProfile` at load time if it is absent
 * from the stored row, so existing channels continue to parse without a
 * destructive DB migration.
 */
const DEFAULT_GUARDRAILS: GuardrailsConfig = {
  preProcessing: {
    contentFiltering: true,
    intentClassification: false,
    maxInputLength: 50000,
  },
  postProcessing: {
    piiRedaction: true,
    outputValidation: true,
  },
  defenseProfile: 'strict',
  canaryTokenEnabled: true,
  auditRetentionDays: 7,
  detection: {
    heuristicThreshold: 60,
    similarityThreshold: 0.85,
    similarityShortCircuitThreshold: 0.92,
    classifierEnabled: true,
    classifierTimeoutMs: 3000,
  },
};

/**
 * Raised by `GuardrailsEngine.preProcess()` when the detection pipeline
 * blocks a message. The pipeline `preProcessStage` catches this, writes
 * the audit event, and converts the error into a user-facing block notice
 * per FR-004.
 */
export class DetectionBlockedError extends Error {
  constructor(
    public readonly decision: DetectionDecision,
    public readonly layerResults: readonly LayerResult[],
  ) {
    super(`Detection blocked input: ${decision.reasonCode} (ref=${decision.referenceId})`);
    this.name = 'DetectionBlockedError';
  }
}

/**
 * Deprecation warning state for the `intentClassification` flag (FR-024).
 * Process-scoped set of channel ids that have already been warned to avoid
 * log spam.
 */
const deprecationWarnedChannels = new Set<string>();

/**
 * Derives a `defenseProfile` from the pre-existing `contentFiltering`
 * boolean per FR-023 when the stored row does not include an explicit
 * profile. Deliberately synchronous — the caller passes all signals.
 */
function deriveDefenseProfile(
  config: GuardrailsConfig,
  hasApprovalGatedTools: boolean,
): GuardrailsConfig['defenseProfile'] {
  if (config.defenseProfile) return config.defenseProfile;
  if (config.preProcessing.contentFiltering === false) return 'permissive';
  return hasApprovalGatedTools ? 'strict' : 'balanced';
}

export class GuardrailsEngine {
  private configCache = new Map<string, { config: GuardrailsConfig; loadedAt: number }>();
  private static CACHE_TTL_MS = 60_000;
  private readonly detection: DetectionEngine;

  constructor(costTracker: CostTracker) {
    this.detection = createDetectionEngine(costTracker);
  }

  /**
   * Returns the internal detection engine so pipeline stages that need to
   * run detection on untrusted content outside of `preProcess()` (e.g. the
   * approval gateway's tool-output filter) can share the same engine
   * instance and cost tracker.
   */
  getDetectionEngine(): DetectionEngine {
    return this.detection;
  }

  /**
   * Queries `approval_policies` for the channel and returns `true` if any row
   * has `policy !== 'auto'`. This is the signal used by FR-023 to decide
   * whether a channel without an explicit `defenseProfile` should default to
   * `strict` (has approval-gated tools) or `balanced` (no gated tools).
   *
   * `auto` means the policy does not require a user decision — the tool runs
   * freely. Every other policy (`ask`, `deny`, `allowlist`) represents a
   * gated approval, so the presence of ANY non-auto row is sufficient to
   * trigger strict defaults.
   *
   * Errors in the query surface as `false` (best-effort) so a transient DB
   * hiccup does not upgrade a channel's profile unexpectedly. The outer
   * catch in `getConfig()` still returns `DEFAULT_GUARDRAILS` on harder
   * failures.
   */
  private async hasNonAutoApprovalPolicies(channelId: string): Promise<boolean> {
    try {
      const rows = await getDb()
        .select({ id: approvalPolicies.id })
        .from(approvalPolicies)
        .where(and(eq(approvalPolicies.channelId, channelId), ne(approvalPolicies.policy, 'auto')))
        .limit(1);
      return rows.length > 0;
    } catch (error) {
      logger.warn(
        'approval_policies lookup failed during defenseProfile derivation; ' +
          'assuming no gated tools (balanced default)',
        { channelId, ...errorDetails(error) },
      );
      return false;
    }
  }

  private async getConfig(channelId: string): Promise<GuardrailsConfig> {
    const cached = this.configCache.get(channelId);
    if (cached && Date.now() - cached.loadedAt < GuardrailsEngine.CACHE_TTL_MS) {
      return cached.config;
    }

    try {
      const row = await getCachedConfig(channelId);

      if (!row?.guardrailsConfig) {
        this.configCache.set(channelId, { config: DEFAULT_GUARDRAILS, loadedAt: Date.now() });
        return DEFAULT_GUARDRAILS;
      }

      // FR-024: log deprecation warning once per process for channels that
      // still have the `intentClassification` key present in the raw JSONB
      // row (REGARDLESS OF VALUE). We inspect the raw row BEFORE Zod parsing
      // because `guardrailsConfigSchema.preProcessing.intentClassification`
      // has a `.default(false)` which makes absent-vs-explicit-false
      // indistinguishable post-parse.
      const rawPreProcessing = (row.guardrailsConfig as { preProcessing?: unknown } | null)
        ?.preProcessing as { intentClassification?: unknown } | undefined;
      const intentClassificationPresent =
        rawPreProcessing !== undefined && Object.hasOwn(rawPreProcessing, 'intentClassification');
      if (intentClassificationPresent && !deprecationWarnedChannels.has(channelId)) {
        logger.warn('guardrails.preProcessing.intentClassification is deprecated and ignored', {
          channelId,
          note: 'This flag was never implemented and is scheduled for removal in a follow-up release. The new multi-layer detection pipeline replaces it. Remove the field from your channel guardrailsConfig to silence this warning.',
        });
        deprecationWarnedChannels.add(channelId);
      }

      const parsed = guardrailsConfigSchema.safeParse(row.guardrailsConfig);
      const config = parsed.success ? (parsed.data as GuardrailsConfig) : DEFAULT_GUARDRAILS;

      if (!parsed.success) {
        logger.warn('Invalid guardrails config, using defaults', {
          channelId,
          errors: parsed.error.issues,
        });
      }

      // FR-023: derive `defenseProfile` from `contentFiltering` +
      // approval_policies when the stored row does not include an explicit
      // profile. Rules:
      //   - contentFiltering === false                                 → permissive
      //   - contentFiltering === true AND any non-auto approval policy → strict
      //   - contentFiltering === true AND no non-auto approval policy  → balanced
      //   - explicit config.defenseProfile always wins (see deriveDefenseProfile)
      //
      // The approval_policies query is skipped when the config already has
      // an explicit defenseProfile (cheap short-circuit).
      const hasApprovalGatedTools = config.defenseProfile
        ? false
        : await this.hasNonAutoApprovalPolicies(channelId);
      const effectiveConfig: GuardrailsConfig = {
        ...config,
        defenseProfile: deriveDefenseProfile(config, hasApprovalGatedTools),
      };

      this.configCache.set(channelId, { config: effectiveConfig, loadedAt: Date.now() });
      return effectiveConfig;
    } catch (error) {
      logger.warn('Failed to load guardrails config, using defaults', {
        channelId,
        ...errorDetails(error),
      });
      return DEFAULT_GUARDRAILS;
    }
  }

  /**
   * FR-001 / FR-004: runs the input-side detection pipeline over a user
   * message. On `block`, writes the audit event and throws a
   * `DetectionBlockedError` that `preProcessStage` catches to produce
   * a user-facing notice. On `neutralize`, returns the rewritten text.
   * On `allow` / `flag`, returns the text unchanged (with truncation).
   */
  async preProcess(params: {
    channelId: string;
    text: string;
    externalUserId: string;
    threadId: string | null;
    recentHistory: readonly string[];
  }): Promise<{ text: string; flagged: boolean; decision: DetectionDecision | null }> {
    const config = await this.getConfig(params.channelId);
    let text = params.text;

    // Run the detection engine over the input.
    const detectionContext: DetectionContext = {
      channelId: params.channelId,
      externalUserId: params.externalUserId,
      threadId: params.threadId,
      sourceKind: 'user_message',
      recentHistory: [...params.recentHistory],
    };

    const result = await this.detection.detect(text, detectionContext, config);

    // Audit every non-allow decision and every allow-with-non-zero-score.
    if (
      result.decision.action !== 'allow' ||
      result.decision.riskScore >= 30 ||
      result.layerResults.some((l) => l.fired)
    ) {
      try {
        await writeAuditEvent({
          decision: result.decision,
          layerResults: result.layerResults,
          channelId: params.channelId,
          externalUserId: params.externalUserId,
          threadId: params.threadId,
          rawExcerpt: params.text,
          canaryHit: false,
        });
      } catch (error) {
        logger.error('Failed to write detection audit event; proceeding', {
          channelId: params.channelId,
          referenceId: result.decision.referenceId,
          error: (error as Error).message,
        });
      }
    }

    if (result.decision.action === 'block') {
      throw new DetectionBlockedError(result.decision, result.layerResults);
    }

    if (result.decision.action === 'neutralize' && result.decision.neutralizedText) {
      text = result.decision.neutralizedText;
    }

    // Truncate to max input length AFTER detection so padding cannot hide an attack.
    const maxLen = config.preProcessing.maxInputLength;
    if (text.length > maxLen) {
      text = `${text.slice(0, maxLen)}\n[Message truncated]`;
    }

    return {
      text,
      flagged: result.decision.action === 'flag',
      decision: result.decision,
    };
  }

  /**
   * Generates a canary token for the current request. Called by
   * `composePromptStage` when `canaryTokenEnabled` is true in the channel config.
   */
  async generateCanaryForChannel(channelId: string): Promise<CanaryToken | null> {
    const config = await this.getConfig(channelId);
    if (config.canaryTokenEnabled === false) return null;
    return generateCanary();
  }

  /**
   * Injects the canary token into the composed system prompt. No-op if
   * the canary is null (disabled for this channel).
   */
  injectCanaryIntoPrompt(systemPrompt: string, canary: CanaryToken | null): string {
    if (!canary) return systemPrompt;
    return injectCanary(systemPrompt, canary);
  }

  /**
   * FR-020 / FR-021 — Post-process checks the LLM response for the canary
   * token. Returns a rewritten response (with a block notice) if the
   * canary was leaked; otherwise applies the normal PII redaction path.
   */
  async postProcess(
    response: string,
    channelId: string,
    canary: CanaryToken | null,
    auditMetadata: {
      externalUserId: string;
      threadId: string | null;
    },
  ): Promise<string> {
    const config = await this.getConfig(channelId);

    if (canary) {
      const canaryResult = checkResponseForCanary(response, canary);
      if (canaryResult.fired) {
        // Write audit event with canary_hit=true.
        const decision: DetectionDecision = {
          action: 'block',
          riskScore: 100,
          layersFired: ['canary'],
          reasonCode: canaryResult.reasonCode ?? 'CANARY_LEAK',
          redactedExcerpt: maskPII(response).slice(0, 500),
          referenceId: `canary_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
          sourceKind: 'canary_leak',
        };
        try {
          await writeAuditEvent({
            decision,
            layerResults: [canaryResult],
            channelId,
            externalUserId: auditMetadata.externalUserId,
            threadId: auditMetadata.threadId,
            rawExcerpt: response,
            canaryHit: true,
          });
        } catch (error) {
          logger.error('Failed to write canary audit event', {
            channelId,
            error: (error as Error).message,
          });
        }
        return `⚠️ Response withheld because a suspected instruction leak was detected. Reference: ${decision.referenceId}`;
      }
    }

    if (config.postProcessing.piiRedaction) {
      return maskPII(response);
    }

    return response;
  }
}
