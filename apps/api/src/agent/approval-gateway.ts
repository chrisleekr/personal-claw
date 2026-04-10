import { getLogger } from '@logtape/logtape';
import { approvalPolicies, channels, eq } from '@personalclaw/db';
import type { ApprovalPolicy, GuardrailsConfig, PlanApprovalState } from '@personalclaw/shared';
import type { ToolExecutionOptions, ToolSet } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';
import type { ChannelAdapter } from '../channels/adapter';
import { getDb } from '../db';
import { HooksEngine } from '../hooks/engine';
import { writeAuditEvent } from './detection/audit';
import type { DetectionEngine } from './detection/engine';
import type { DetectionContext, DetectionDecision } from './detection/types';
import { getToolTrustCategory, type ToolTrustCategory } from './tool-trust';

const logger = getLogger(['personalclaw', 'agent', 'approval-gateway']);

const hooks = HooksEngine.getInstance();

const BATCH_WINDOW_MS = 100;

export class PlanRejectedError extends Error {
  constructor(public readonly reason: 'rejected' | 'timeout') {
    super(`Plan ${reason} by user`);
    this.name = 'PlanRejectedError';
  }
}

interface ApprovalPolicyRow {
  policy: string;
  allowedUsers: string[];
}

interface PatternPolicyEntry {
  pattern: RegExp;
  specificity: number;
  row: ApprovalPolicyRow;
}

export function globToRegex(glob: string): RegExp {
  const regexStr = glob.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${regexStr}$`);
}

export interface DismissedPlan {
  summary: string;
  steps: string[];
}

interface PendingBatchEntry {
  toolName: string;
  args: Record<string, unknown>;
  policy: string;
  resolve: (approved: boolean) => void;
}

export class ApprovalGateway {
  planApprovalState: PlanApprovalState | null = null;
  lastPlan: DismissedPlan | null = null;
  readonly toolTimings = new Map<string, number>();
  private policyCache: Map<string, ApprovalPolicyRow> | null = null;
  private patternPolicies: PatternPolicyEntry[] = [];
  private pendingBatch: PendingBatchEntry[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private channelId: string,
    private threadId: string,
    private userId: string,
    private adapter: ChannelAdapter,
    private safeToolNames: Set<string> = new Set(),
    private verifiedUserId = false,
    /**
     * When true, the detection pipeline flagged the current turn as
     * suspicious (FR-005). Tools must NOT auto-execute in this mode —
     * every invocation goes through individual approval even if a plan
     * was approved or the tool has an `auto` policy.
     */
    private detectionFlagged = false,
    /**
     * Optional detection engine for filtering untrusted tool outputs per
     * FR-006 and the tiered trust model in FR-030. When present, every
     * tool output from a Category 3 (`external_untrusted`) or Category 4
     * (`mixed`) tool is routed through `detectionEngine.detect()` with
     * `sourceKind: 'tool_result'` before being returned to the LLM; blocked
     * fields are replaced with a neutralizing placeholder and audit-logged.
     * When absent, tool outputs pass through unchanged (legacy behavior).
     */
    private detectionEngine: DetectionEngine | null = null,
  ) {}

  private async loadPolicies(): Promise<Map<string, ApprovalPolicyRow>> {
    if (this.policyCache) return this.policyCache;

    const db = getDb();
    const rows = await db
      .select({
        toolName: approvalPolicies.toolName,
        policy: approvalPolicies.policy,
        allowedUsers: approvalPolicies.allowedUsers,
      })
      .from(approvalPolicies)
      .where(eq(approvalPolicies.channelId, this.channelId));

    logger.debug('Loaded approval policies from DB', {
      channelId: this.channelId,
      rowCount: rows.length,
      rows: rows.map((r) => ({ toolName: r.toolName, policy: r.policy })),
    });

    const exact = new Map<string, ApprovalPolicyRow>();
    const patterns: PatternPolicyEntry[] = [];

    for (const r of rows) {
      const row: ApprovalPolicyRow = { policy: r.policy, allowedUsers: r.allowedUsers };
      if (r.toolName.includes('*')) {
        patterns.push({
          pattern: globToRegex(r.toolName),
          specificity: r.toolName.replace(/\*/g, '').length,
          row,
        });
      } else {
        exact.set(r.toolName, row);
      }
    }

    patterns.sort((a, b) => b.specificity - a.specificity);

    logger.debug('Parsed approval policies', {
      exactCount: exact.size,
      patternCount: patterns.length,
      patterns: patterns.map((p) => ({ regex: p.pattern.source, specificity: p.specificity })),
    });

    this.policyCache = exact;
    this.patternPolicies = patterns;
    return this.policyCache;
  }

  private async flushBatch(): Promise<void> {
    this.batchTimer = null;
    const batch = this.pendingBatch.splice(0);
    if (batch.length === 0) return;

    if (batch.length === 1) {
      const { toolName, args, policy, resolve } = batch[0];
      const approved = await this.adapter.requestApproval({
        threadId: this.threadId,
        toolName,
        args,
      });
      await this.emitToolHook(toolName, args, approved, policy);
      resolve(approved);
      return;
    }

    const tools = batch.map((b) => ({ toolName: b.toolName, args: b.args }));

    let approved: boolean;
    if (this.adapter.requestBatchApproval) {
      approved = await this.adapter.requestBatchApproval({
        threadId: this.threadId,
        tools,
      });
    } else {
      approved = await this.adapter.requestApproval({
        threadId: this.threadId,
        toolName: tools.map((t) => t.toolName).join(', '),
        args: Object.fromEntries(tools.map((t) => [t.toolName, t.args])),
      });
    }

    await Promise.all(batch.map((b) => this.emitToolHook(b.toolName, b.args, approved, b.policy)));
    for (const entry of batch) {
      entry.resolve(approved);
    }
  }

  private queueForApproval(
    toolName: string,
    args: Record<string, unknown>,
    policy: string,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.pendingBatch.push({ toolName, args, policy, resolve });

      if (!this.batchTimer) {
        this.batchTimer = setTimeout(() => this.flushBatch(), BATCH_WINDOW_MS);
      }
    });
  }

  private async emitToolHook(
    toolName: string,
    args: Record<string, unknown>,
    approved: boolean,
    policy: string,
  ): Promise<void> {
    // Tool approval event; non-audit-critical side-channel. Discard the
    // HookEmitResult per FR-029 — handler failures are logged by the engine
    // but must not block tool execution.
    void (await hooks.emit('tool:called', {
      channelId: this.channelId,
      externalUserId: this.userId,
      threadId: this.threadId,
      eventType: 'tool:called',
      payload: { toolName, args, approved, policy },
    }));
  }

  private findPatternMatch(toolName: string): ApprovalPolicyRow | undefined {
    for (const entry of this.patternPolicies) {
      if (entry.pattern.test(toolName)) return entry.row;
    }
    return undefined;
  }

  async checkApproval(toolName: string, args: Record<string, unknown>): Promise<boolean> {
    const policies = await this.loadPolicies();
    const exactMatch = policies.get(toolName);
    const patternMatch = exactMatch ? undefined : this.findPatternMatch(toolName);
    const row = exactMatch ?? patternMatch;

    logger.debug('Checking approval', {
      toolName,
      channelId: this.channelId,
      matchType: exactMatch ? 'exact' : patternMatch ? 'pattern' : 'none',
      matchedPolicy: row?.policy ?? null,
      patternCount: this.patternPolicies.length,
    });

    if (row) {
      const policy = row.policy as ApprovalPolicy;

      if (policy === 'deny') {
        await this.emitToolHook(toolName, args, false, policy);
        return false;
      }

      if (policy === 'auto') {
        // FR-005: flagged messages never auto-execute tools.
        if (this.detectionFlagged) {
          logger.info('Auto policy downgraded to ask due to detectionFlagged', {
            toolName,
            channelId: this.channelId,
          });
          return this.queueForApproval(toolName, args, 'auto-flagged');
        }
        await this.emitToolHook(toolName, args, true, policy);
        return true;
      }

      if (policy === 'allowlist') {
        if (!this.verifiedUserId) {
          logger.info('Allowlist check skipped: user identity not verified, falling back to ask', {
            toolName,
            channelId: this.channelId,
            externalUserId: this.userId,
          });
          return this.queueForApproval(toolName, args, 'allowlist-unverified');
        }
        const allowed = row.allowedUsers.includes(this.userId);
        await this.emitToolHook(toolName, args, allowed, policy);
        return allowed;
      }

      if (policy === 'ask') {
        return this.queueForApproval(toolName, args, policy);
      }
    }

    if (this.planApprovalState) {
      const { approvedToolNames, approvedAt, timeoutMs } = this.planApprovalState;
      const elapsed = Date.now() - approvedAt;
      if (elapsed < timeoutMs && approvedToolNames.has(toolName)) {
        // FR-005: flagged messages never auto-execute even via plan approval.
        if (this.detectionFlagged) {
          logger.info('Plan-approved execution downgraded to ask due to detectionFlagged', {
            toolName,
            channelId: this.channelId,
          });
          return this.queueForApproval(toolName, args, 'plan-flagged');
        }
        await this.emitToolHook(toolName, args, true, 'plan');
        return true;
      }
      if (elapsed >= timeoutMs) {
        logger.info('Plan approval expired', {
          toolName,
          channelId: this.channelId,
          externalUserId: this.userId,
          elapsedMs: elapsed,
          timeoutMs,
        });
      } else {
        logger.info('Tool not in approved plan scope', {
          toolName,
          channelId: this.channelId,
          externalUserId: this.userId,
          approvedTools: [...approvedToolNames],
        });
      }
    }

    if (this.safeToolNames.has(toolName)) {
      await this.emitToolHook(toolName, args, true, 'safe');
      return true;
    }

    logger.info('No policy matched, queuing for user approval', {
      toolName,
      channelId: this.channelId,
      externalUserId: this.userId,
      hasPlanApproval: !!this.planApprovalState,
      isSafeTool: this.safeToolNames.has(toolName),
    });
    return this.queueForApproval(toolName, args, 'default');
  }

  async getAutoApprovedNames(toolNames: string[]): Promise<Set<string>> {
    await this.loadPolicies();
    const result = new Set<string>();
    for (const name of toolNames) {
      const exactMatch = this.policyCache?.get(name);
      const row = exactMatch ?? this.findPatternMatch(name);
      if (row?.policy === 'auto') result.add(name);
    }
    return result;
  }

  wrapTools(tools: ToolSet): ToolSet {
    const wrapped: ToolSet = {};
    for (const [name, t] of Object.entries(tools)) {
      const originalExecute = t.execute;
      if (!originalExecute) {
        wrapped[name] = t;
        continue;
      }

      wrapped[name] = {
        ...t,
        execute: async (args: Record<string, unknown>, options: ToolExecutionOptions) => {
          const approved = await this.checkApproval(name, args);
          if (!approved) {
            return {
              error: true,
              message: `Tool "${name}" was denied or timed out. Ask the user if they want to retry.`,
            };
          }
          const start = performance.now();
          const result = await (originalExecute as (...args: unknown[]) => unknown)(args, options);
          this.toolTimings.set(options.toolCallId, Math.round(performance.now() - start));
          // FR-006 / FR-030 tool-output detection: route untrusted tool
          // results through the detection engine before they reach the LLM.
          // Trusted categories (system_generated, already_detected) bypass
          // detection and return as-is. Skipped entirely when no detection
          // engine is wired (legacy unit tests).
          return this.filterUntrustedResult(name, result);
        },
      };
    }
    return wrapped;
  }

  /** Fetches the channel's approval timeout from the database. */
  private async getApprovalTimeoutMs(): Promise<number> {
    const db = getDb();
    const [row] = await db
      .select({ approvalTimeoutMs: channels.approvalTimeoutMs })
      .from(channels)
      .where(eq(channels.id, this.channelId));
    return row?.approvalTimeoutMs ?? 600_000;
  }

  /**
   * FR-006 / FR-030 — Post-execute tool-output detection.
   *
   * Routes every `string` field in a tool's return value through the
   * detection engine (with `sourceKind: 'tool_result'`) when the tool's
   * trust category is `external_untrusted` or `mixed`. Strings found to
   * contain injection payloads are replaced with a neutralizing placeholder
   * and audit-logged.
   *
   * Traversal is bounded per research.md R3 to prevent expensive recursion
   * on malicious or runaway results:
   *
   * - Maximum depth: 5
   * - Maximum total string bytes inspected: 200 KB
   * - Binary / non-string fields (images, arrays of numbers, booleans) pass
   *   through unchanged — they cannot carry text-based injections, and
   *   OCR-based detection is explicitly out of scope per FR-spec §Known
   *   Limitations.
   *
   * On `block` from detection, the offending string becomes:
   *   `[tool output blocked as suspected injection: ref=<refId>]`
   *
   * The tool caller (the LLM) sees this placeholder and can react. Other
   * fields of the result remain intact so the tool-call as a whole is not
   * uselessly discarded.
   */
  private async filterUntrustedResult(toolName: string, result: unknown): Promise<unknown> {
    if (!this.detectionEngine) return result;

    const category = getToolTrustCategory(toolName);
    if (category === 'system_generated' || category === 'already_detected') {
      return result;
    }

    const traversal = new UntrustedResultTraversal(
      this.detectionEngine,
      this.channelId,
      this.userId,
      this.threadId,
      toolName,
      category,
    );
    return traversal.walk(result, 0);
  }

  getConfirmPlanTool() {
    return tool({
      description:
        'Present an execution plan to the user for approval before using non-autonomous tools. ' +
        'Only call this when you need tools that are NOT in the autonomous tools list. ' +
        'Do NOT call this for conversational responses or when using only autonomous tools.',
      inputSchema: z.object({
        summary: z.string().describe('Brief description of what you plan to do and why'),
        steps: z
          .array(z.string())
          .describe('Ordered list of steps you will take, including which tools you will call'),
        toolNames: z.array(z.string()).describe('Exact tool names you intend to call in this plan'),
      }),
      execute: async ({ summary, steps, toolNames }) => {
        this.lastPlan = { summary, steps };

        const approved = await this.adapter.requestPlanApproval({
          threadId: this.threadId,
          planSummary: summary,
          steps,
        });

        if (approved) {
          const timeoutMs = await this.getApprovalTimeoutMs();
          this.planApprovalState = {
            approvedToolNames: new Set(toolNames),
            approvedAt: Date.now(),
            timeoutMs,
          };
          logger.info('Plan approved with scoped tools', {
            channelId: this.channelId,
            toolNames,
            timeoutMs,
          });
          return { approved: true, message: 'Plan approved. Proceed with the steps.' };
        }
        throw new PlanRejectedError('rejected');
      },
    });
  }
}

/**
 * Stateful helper that walks a tool result object, runs detection on every
 * string field it finds, and replaces blocked fields with a neutralizing
 * placeholder. The state (bytes inspected, depth tracking) prevents
 * runaway traversal on malicious or large results.
 */
class UntrustedResultTraversal {
  private static MAX_DEPTH = 5;
  private static MAX_TOTAL_BYTES = 200_000;
  private static MIN_LENGTH_TO_SCAN = 16; // strings shorter than this are not worth the detection cost
  private bytesInspected = 0;
  private readonly logger = logger;
  // Minimal default GuardrailsConfig for tool-output detection: classifier
  // disabled for speed (tool outputs are typically short and the heuristic +
  // similarity layers are enough), canary disabled (no LLM call here),
  // balanced profile so layer failures fail-open.
  private static DETECTION_CONFIG: GuardrailsConfig = {
    preProcessing: {
      contentFiltering: true,
      intentClassification: false,
      maxInputLength: 50000,
    },
    postProcessing: { piiRedaction: false, outputValidation: true },
    defenseProfile: 'balanced',
    canaryTokenEnabled: false,
    auditRetentionDays: 7,
    detection: {
      heuristicThreshold: 60,
      similarityThreshold: 0.85,
      similarityShortCircuitThreshold: 0.92,
      classifierEnabled: false,
      classifierTimeoutMs: 3000,
    },
  };

  constructor(
    private engine: DetectionEngine,
    private channelId: string,
    private externalUserId: string,
    private threadId: string,
    private toolName: string,
    private category: ToolTrustCategory,
  ) {}

  /**
   * Walks a value and returns a possibly-mutated copy with blocked strings
   * replaced. Depth limit + total-bytes limit bound the work.
   */
  async walk(value: unknown, depth: number): Promise<unknown> {
    if (depth > UntrustedResultTraversal.MAX_DEPTH) return value;
    if (this.bytesInspected >= UntrustedResultTraversal.MAX_TOTAL_BYTES) return value;

    if (typeof value === 'string') {
      return this.handleString(value);
    }
    if (Array.isArray(value)) {
      const out: unknown[] = [];
      for (const item of value) {
        out.push(await this.walk(item, depth + 1));
      }
      return out;
    }
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        out[key] = await this.walk(v, depth + 1);
      }
      return out;
    }
    // numbers, booleans, null, undefined — pass through
    return value;
  }

  private async handleString(str: string): Promise<string> {
    // Skip short strings to avoid paying the detection cost on field labels,
    // URL prefixes, status codes, etc.
    if (str.length < UntrustedResultTraversal.MIN_LENGTH_TO_SCAN) {
      return str;
    }
    // Skip once we've exceeded the byte budget; remaining strings pass through.
    const bytesRemaining = UntrustedResultTraversal.MAX_TOTAL_BYTES - this.bytesInspected;
    if (bytesRemaining <= 0) return str;

    // Truncate the string we pass to detection so a single huge string cannot
    // starve the budget. The original is returned unchanged if detection
    // passes — we only inspect a slice.
    const slice = str.length > bytesRemaining ? str.slice(0, bytesRemaining) : str;
    this.bytesInspected += slice.length;

    const context: DetectionContext = {
      channelId: this.channelId,
      externalUserId: this.externalUserId,
      threadId: this.threadId,
      sourceKind: 'tool_result',
      recentHistory: [],
    };

    try {
      const result = await this.engine.detect(
        slice,
        context,
        UntrustedResultTraversal.DETECTION_CONFIG,
      );
      if (result.decision.action !== 'block') {
        return str;
      }
      // Block: audit + replace with neutralizing placeholder.
      await this.auditToolResultBlock(result.decision, slice);
      return `[tool output from ${this.toolName} blocked as suspected injection: ref=${result.decision.referenceId}]`;
    } catch (error) {
      this.logger.warn('Tool-output detection failed; returning original (fail-open)', {
        toolName: this.toolName,
        channelId: this.channelId,
        error: (error as Error).message,
      });
      return str;
    }
  }

  private async auditToolResultBlock(
    decision: DetectionDecision,
    rawExcerpt: string,
  ): Promise<void> {
    try {
      await writeAuditEvent({
        decision: { ...decision, sourceKind: 'tool_result' },
        layerResults: [],
        channelId: this.channelId,
        externalUserId: this.externalUserId,
        threadId: this.threadId,
        rawExcerpt,
        canaryHit: false,
      });
    } catch (error) {
      this.logger.error('Failed to audit tool-output block', {
        toolName: this.toolName,
        referenceId: decision.referenceId,
        error: (error as Error).message,
      });
    }
    // Reference the category so lint doesn't complain about the unused field
    // and future readers can see how it's used to scope the audit reason.
    this.logger.info('Tool output blocked by detection', {
      toolName: this.toolName,
      category: this.category,
      referenceId: decision.referenceId,
    });
  }
}
