import { getLogger } from '@logtape/logtape';
import type { AllMiddlewareArgs, BlockAction, SayFn, SlackActionMiddlewareArgs } from '@slack/bolt';

type SlackWebClient = AllMiddlewareArgs['client'];

const logger = getLogger(['personalclaw', 'slack', 'approvals']);

export class ApprovalDismissedError extends Error {
  constructor() {
    super('Approval dismissed by new message');
    this.name = 'ApprovalDismissedError';
  }
}

interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  elements?: unknown[];
}

interface PendingEntry {
  resolve: (approved: boolean) => void;
  reject: (error: Error) => void;
  threadTs: string;
  messageTs?: string;
  slackChannelId?: string;
  textBlocks?: SlackBlock[];
}

const pendingApprovals = new Map<string, PendingEntry>();

export async function dismissPendingApprovals(
  threadTs: string,
  client?: SlackWebClient,
): Promise<void> {
  for (const [id, entry] of pendingApprovals) {
    if (entry.threadTs === threadTs) {
      logger.debug('Dismissing pending approval due to new message', {
        approvalId: id,
        threadTs,
      });
      entry.reject(new ApprovalDismissedError());
      pendingApprovals.delete(id);

      if (client && entry.messageTs && entry.slackChannelId) {
        client.chat
          .update({
            channel: entry.slackChannelId,
            ts: entry.messageTs,
            text: 'Approval dismissed.',
            blocks: [
              ...(entry.textBlocks ?? []),
              {
                type: 'context',
                elements: [{ type: 'mrkdwn', text: '_Dismissed — new message received._' }],
              },
            ],
          })
          .catch((err) => {
            logger.error('Failed to update dismissed approval message', {
              approvalId: id,
              error: (err as Error).message,
            });
          });
      }
    }
  }
}

function storeMessageMetadata(
  pendingId: string,
  channelId: string,
  textBlocks: SlackBlock[],
  sayResult: Promise<{ ts?: string }>,
): void {
  sayResult
    .then((result) => {
      const entry = pendingApprovals.get(pendingId);
      if (entry && result?.ts) {
        entry.messageTs = result.ts;
        entry.slackChannelId = channelId;
        entry.textBlocks = textBlocks;
      }
    })
    .catch((err) => {
      logger.error('Failed to post approval message', {
        pendingId,
        error: (err as Error).message,
      });
    });
}

export async function requestApproval(params: {
  channelId: string;
  threadTs: string;
  toolName: string;
  args: Record<string, unknown>;
  say: SayFn;
}): Promise<boolean> {
  const approvalId = `approval_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  logger.debug('Requesting tool approval', {
    approvalId,
    channelId: params.channelId,
    threadTs: params.threadTs,
    toolName: params.toolName,
    args: params.args,
  });

  return new Promise<boolean>((resolve, reject) => {
    pendingApprovals.set(approvalId, { resolve, reject, threadTs: params.threadTs });

    const textBlock: SlackBlock = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Tool approval required*\nTool: \`${params.toolName}\`\nArgs: \`${JSON.stringify(params.args)}\``,
      },
    };

    const sayResult = params.say({
      thread_ts: params.threadTs,
      text: `Tool approval required: ${params.toolName}`,
      blocks: [
        textBlock,
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Approve' },
              style: 'primary',
              action_id: `approval_approve_${approvalId}`,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Deny' },
              style: 'danger',
              action_id: `approval_deny_${approvalId}`,
            },
          ],
        },
      ],
    });

    storeMessageMetadata(approvalId, params.channelId, [textBlock], sayResult);

    setTimeout(() => {
      if (pendingApprovals.has(approvalId)) {
        pendingApprovals.delete(approvalId);
        resolve(false);
      }
    }, 300_000);
  });
}

function summarizeBatchArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return '';
  const parts = entries.slice(0, 3).map(([k, v]) => {
    const val = typeof v === 'string' ? v : JSON.stringify(v);
    return `${k}: \`${val.length > 60 ? `${val.slice(0, 57)}…` : val}\``;
  });
  return parts.join(', ');
}

export async function requestBatchApproval(params: {
  channelId: string;
  threadTs: string;
  tools: Array<{ toolName: string; args: Record<string, unknown> }>;
  say: SayFn;
}): Promise<boolean> {
  const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  logger.debug('Requesting batch tool approval', {
    batchId,
    channelId: params.channelId,
    threadTs: params.threadTs,
    toolNames: params.tools.map((t) => t.toolName),
  });

  return new Promise<boolean>((resolve, reject) => {
    pendingApprovals.set(batchId, { resolve, reject, threadTs: params.threadTs });

    const toolLines = params.tools
      .map((t) => {
        const argSummary = summarizeBatchArgs(t.args);
        return `• \`${t.toolName}\`${argSummary ? `  —  ${argSummary}` : ''}`;
      })
      .join('\n');

    const textBlock: SlackBlock = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Tool approval required* (${params.tools.length} tools)\n${toolLines}`,
      },
    };

    const sayResult = params.say({
      thread_ts: params.threadTs,
      text: `Tool approval required for ${params.tools.length} tools`,
      blocks: [
        textBlock,
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Approve All' },
              style: 'primary',
              action_id: `batch_approve_${batchId}`,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Deny All' },
              style: 'danger',
              action_id: `batch_deny_${batchId}`,
            },
          ],
        },
      ],
    });

    storeMessageMetadata(batchId, params.channelId, [textBlock], sayResult);

    setTimeout(() => {
      if (pendingApprovals.has(batchId)) {
        pendingApprovals.delete(batchId);
        resolve(false);
      }
    }, 300_000);
  });
}

export async function requestPlanApproval(params: {
  channelId: string;
  threadTs: string;
  planSummary: string;
  steps: string[];
  say: SayFn;
}): Promise<boolean> {
  const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  logger.debug('Requesting plan approval', {
    planId,
    channelId: params.channelId,
    threadTs: params.threadTs,
    planSummary: params.planSummary,
    steps: params.steps,
  });

  return new Promise<boolean>((resolve, reject) => {
    pendingApprovals.set(planId, { resolve, reject, threadTs: params.threadTs });

    const stepsText = params.steps
      .map((s, i) => `${i + 1}. ${s.replace(/^\d+\.\s*/, '')}`)
      .join('\n');

    const summaryBlock: SlackBlock = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Execution plan — approval required*\n${params.planSummary}`,
      },
    };

    const stepsBlock: SlackBlock = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Steps:*\n${stepsText}`,
      },
    };

    const sayResult = params.say({
      thread_ts: params.threadTs,
      text: `Execution plan — approval required: ${params.planSummary}`,
      blocks: [
        summaryBlock,
        stepsBlock,
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Approve' },
              style: 'primary',
              action_id: `plan_approve_${planId}`,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Reject' },
              style: 'danger',
              action_id: `plan_reject_${planId}`,
            },
          ],
        },
      ],
    });

    storeMessageMetadata(planId, params.channelId, [summaryBlock, stepsBlock], sayResult);

    setTimeout(() => {
      if (pendingApprovals.has(planId)) {
        pendingApprovals.delete(planId);
        resolve(false);
      }
    }, 300_000);
  });
}

export async function handleApprovalAction({
  action,
  ack,
  respond,
}: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
  await ack();
  const actionId = action.action_id as string;

  const isPlan = actionId.startsWith('plan_');
  const isApproval = actionId.startsWith('approval_');
  const isBatch = actionId.startsWith('batch_');

  if (!isPlan && !isApproval && !isBatch) return;

  let approved: boolean;
  let pendingId: string;

  if (isPlan) {
    approved = actionId.includes('_approve_');
    pendingId = actionId.replace('plan_approve_', '').replace('plan_reject_', '');
  } else if (isBatch) {
    approved = actionId.includes('_approve_');
    pendingId = actionId.replace('batch_approve_', '').replace('batch_deny_', '');
  } else {
    approved = actionId.includes('_approve_');
    pendingId = actionId.replace('approval_approve_', '').replace('approval_deny_', '');
  }

  const pending = pendingApprovals.get(pendingId);
  if (pending) {
    logger.debug('Approval action received', {
      pendingId,
      isPlan,
      isBatch,
      approved,
    });
    pending.resolve(approved);
    pendingApprovals.delete(pendingId);

    const label = isPlan ? 'Plan' : isBatch ? 'Batch tool execution' : 'Tool execution';
    const verb = approved ? 'approved' : isPlan ? 'rejected' : 'denied';
    await respond({
      replace_original: true,
      text: `${label} ${verb}.`,
      blocks: [
        ...(pending.textBlocks ?? []),
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `_${label} ${verb}._` }],
        },
      ],
    });
  } else {
    logger.debug('Approval action for unknown/expired pending entry', {
      pendingId,
      isPlan,
      isBatch,
      approved,
    });
  }
}
