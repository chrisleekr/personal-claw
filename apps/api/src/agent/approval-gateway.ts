import { getLogger } from '@logtape/logtape';
import { approvalPolicies, channels, eq } from '@personalclaw/db';
import type { ApprovalPolicy, PlanApprovalState } from '@personalclaw/shared';
import type { ToolExecutionOptions, ToolSet } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';
import type { ChannelAdapter } from '../channels/adapter';
import { getDb } from '../db';
import { HooksEngine } from '../hooks/engine';

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
    await hooks.emit('tool:called', {
      channelId: this.channelId,
      externalUserId: this.userId,
      threadId: this.threadId,
      eventType: 'tool:called',
      payload: { toolName, args, approved, policy },
    });
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
        await this.emitToolHook(toolName, args, true, policy);
        return true;
      }

      if (policy === 'allowlist') {
        if (!this.verifiedUserId) {
          logger.info('Allowlist check skipped: user identity not verified, falling back to ask', {
            toolName,
            channelId: this.channelId,
            userId: this.userId,
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
        await this.emitToolHook(toolName, args, true, 'plan');
        return true;
      }
      if (elapsed >= timeoutMs) {
        logger.info('Plan approval expired', {
          toolName,
          channelId: this.channelId,
          elapsedMs: elapsed,
          timeoutMs,
        });
      } else {
        logger.info('Tool not in approved plan scope', {
          toolName,
          channelId: this.channelId,
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
          return result;
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
