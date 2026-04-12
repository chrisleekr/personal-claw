/**
 * In-process type definitions for the multi-layer injection detection
 * pipeline. These are value objects used by the pipeline stages and the
 * `DetectionEngine` orchestrator; they are not persisted (audit rows are
 * persisted via `packages/db/src/schema/detection-audit-events.ts`).
 *
 * Spec anchors:
 * - FR-002: five input-side layers + output-side canary
 * - FR-003: structured decision shape
 * - FR-004: reference id surfaced to users
 * - Data model: specs/20260409-185147-injection-defense-pipeline/data-model.md §3
 */

/**
 * The final action the pipeline decided for a given piece of untrusted content.
 *
 * - `allow` — content passed unchanged into the LLM context
 * - `flag` — content passed into the LLM context but downstream safeguards are
 *   tightened (no tools auto-execute per FR-005), and an audit event is emitted
 * - `block` — content is not passed to the LLM at all; the user is notified per FR-004
 *
 * Note: a `neutralize` action was declared in earlier drafts but never
 * implemented by any layer. It was removed in Phase 7 T092 (2026-04-10)
 * after /speckit.analyze flagged it as unreachable code. The `structural`
 * layer already wraps untrusted content via `wrapAsUntrusted()` at the
 * call site, so a separate `neutralize` action was not needed.
 */
export type DetectionAction = 'allow' | 'flag' | 'block';

/**
 * Classification of where a piece of content originated. Used by the pipeline
 * to decide whether detection must run and by the audit writer to record the
 * source category for incident review.
 */
export type SourceKind =
  | 'user_message'
  | 'tool_result'
  | 'memory_recall'
  | 'conversation_history'
  | 'generate_skill_input'
  | 'canary_leak';

/**
 * Stable identifiers for each layer in the detection pipeline. These strings
 * appear in `layersFired` on audit events and are used for per-layer latency
 * measurements in the benchmark script.
 */
export type LayerId =
  | 'normalize'
  | 'structural'
  | 'heuristics'
  | 'similarity'
  | 'classifier'
  | 'canary';

/**
 * Per-layer output consumed by the `DetectionEngine` orchestrator when
 * composing the final decision.
 *
 * - `fired === true` implies `reasonCode !== null`.
 * - `shortCircuit === true` is only valid for layers capable of high-confidence
 *   early termination (currently `similarity` and `classifier`).
 * - `error` populated means the layer could not reach a decision — the engine
 *   converts this to the per-profile fail-closed / fail-open policy from FR-011
 *   rather than silently ignoring it per FR-017.
 */
export interface LayerResult {
  layerId: LayerId;
  fired: boolean;
  score: number; // 0..100
  reasonCode: string | null;
  shortCircuit: boolean;
  latencyMs: number;
  error?: {
    kind: 'timeout' | 'unavailable' | 'internal';
    message: string;
  };
}

/**
 * Structured result produced by `DetectionEngine.detect()` for a single piece
 * of untrusted content.
 *
 * Per FR-003, every field is mandatory. Per FR-004, `referenceId` is surfaced
 * to end-users so they can share it with admins to request review; it matches
 * the `reference_id` column on `detection_audit_events`.
 */
export interface DetectionDecision {
  action: DetectionAction;
  riskScore: number; // 0..100, max across fired layers
  layersFired: LayerId[];
  reasonCode: string;
  redactedExcerpt: string;
  referenceId: string;
  sourceKind: SourceKind;
}

/**
 * Per-request canary token attached to the pipeline context by
 * `composePromptStage` and consumed by `postProcessStage`. Not persisted;
 * discarded after the response is delivered to the user.
 *
 * Per research.md R2, the `token` is a cryptographically random 32-char hex
 * string prefixed with `pc_canary_` and embedded in the system prompt inside
 * an `<internal_state token="..." DO_NOT_ECHO>` marker block.
 */
export interface CanaryToken {
  token: string;
  emittedAt: number;
  placementHint: string;
}

/**
 * Context passed into `DetectionEngine.detect()`. Includes everything needed
 * to write a correct audit event (channel, user, thread, source) and to pass
 * the multi-turn history window (FR-012) through to layers that can use it.
 *
 * Note: `CostTracker` is NOT included here. It is injected into
 * `DetectionEngine` via its constructor so the classifier layer can call
 * `CostTracker.log()` after every `generateText` invocation per Constitution
 * VII. Keeping the dependency out of this context type lets the type live in
 * `apps/api` without cross-package imports while staying strictly typed.
 */
export interface DetectionContext {
  channelId: string;
  externalUserId: string;
  threadId: string | null;
  sourceKind: SourceKind;
  /**
   * Last 10 `role: 'user'` messages from the current thread per FR-012.
   * Populated by the pipeline stage invoking detection (typically
   * `preProcessStage`). When the thread has fewer than 10 user messages,
   * the caller passes whatever is available, including an empty array.
   */
  recentHistory: string[];
}
