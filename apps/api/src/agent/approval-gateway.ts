import { approvalPolicies, eq } from '@personalclaw/db';
import type { ApprovalPolicy } from '@personalclaw/shared';
import type { ToolExecutionOptions, ToolSet } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';
import type { ChannelAdapter } from '../channels/adapter';
import { getDb } from '../db';
import { HooksEngine } from '../hooks/engine';

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
  planApproved = false;
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
    const row = policies.get(toolName) ?? this.findPatternMatch(toolName);

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
        const allowed = row.allowedUsers.includes(this.userId);
        await this.emitToolHook(toolName, args, allowed, policy);
        return allowed;
      }

      if (policy === 'ask') {
        return this.queueForApproval(toolName, args, policy);
      }
    }

    if (this.planApproved) {
      await this.emitToolHook(toolName, args, true, 'plan');
      return true;
    }

    if (this.safeToolNames.has(toolName)) {
      await this.emitToolHook(toolName, args, true, 'safe');
      return true;
    }

    return this.queueForApproval(toolName, args, 'default');
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
          const result = await (originalExecute as (...args: never) => unknown)(args, options);
          this.toolTimings.set(options.toolCallId, Math.round(performance.now() - start));
          return result;
        },
      };
    }
    return wrapped;
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
      }),
      execute: async ({ summary, steps }) => {
        this.lastPlan = { summary, steps };

        const approved = await this.adapter.requestPlanApproval({
          threadId: this.threadId,
          planSummary: summary,
          steps,
        });

        this.planApproved = approved;

        if (approved) {
          return { approved: true, message: 'Plan approved. Proceed with the steps.' };
        }
        throw new PlanRejectedError('rejected');
      },
    });
  }
}
