import { getLogger } from '@logtape/logtape';
import type { SayFn } from '@slack/bolt';
import { APICallError } from 'ai';

interface SlackReactionsClient {
  reactions: {
    add: (args: { channel: string; timestamp: string; name: string }) => Promise<unknown>;
    remove: (args: { channel: string; timestamp: string; name: string }) => Promise<unknown>;
  };
}

import type { ImageAttachment, ThreadReplyMode } from '@personalclaw/shared';
import { threadReplyModeSchema } from '@personalclaw/shared';
import { MessageOrchestrator } from '../../agent/orchestrator';
import { autoRegisterChannel } from '../../channels/auto-register';
import { getCachedConfig } from '../../channels/config-cache';
import { ChannelNotFoundError, ChannelResolver } from '../../channels/resolver';
import { config } from '../../config';
import { checkRateLimit } from '../../middleware/rate-limiter';
import { errorDetails } from '../../utils/error-fmt';
import { SlackAdapter } from './adapter';
import { ApprovalDismissedError } from './approvals';
import { withThreadLock } from './thread-lock';

const logger = getLogger(['personalclaw', 'slack', 'handlers']);
const orchestrator = new MessageOrchestrator();

interface SlackConversationsClient {
  conversations: {
    replies: (args: {
      channel: string;
      ts: string;
      limit: number;
      inclusive: boolean;
    }) => Promise<{ messages?: Array<{ user?: string }> }>;
  };
}

export interface HandleMessageParams {
  channelId: string;
  threadId: string;
  userId: string;
  text: string;
  messageTs: string;
  isMention: boolean;
  images?: ImageAttachment[];
  say: SayFn;
  client: SlackReactionsClient & SlackConversationsClient;
}

async function resolveChannel(slackChannelId: string): Promise<string> {
  const resolver = ChannelResolver.getInstance();
  try {
    const channel = await resolver.resolve('slack', slackChannelId);
    return channel.id;
  } catch (error) {
    if (error instanceof ChannelNotFoundError) {
      logger.info`Auto-registering Slack channel ${slackChannelId}`;
      const channel = await autoRegisterChannel('slack', slackChannelId);
      return channel.id;
    }
    throw error;
  }
}

async function addReaction(client: SlackReactionsClient, channel: string, ts: string) {
  try {
    await client.reactions.add({ channel, timestamp: ts, name: 'hourglass_flowing_sand' });
  } catch {
    logger.debug('Failed to add thinking reaction (may lack reactions:write scope)');
  }
}

async function removeReaction(client: SlackReactionsClient, channel: string, ts: string) {
  try {
    await client.reactions.remove({ channel, timestamp: ts, name: 'hourglass_flowing_sand' });
  } catch {
    logger.debug('Failed to remove thinking reaction');
  }
}

export async function handleMessage({
  channelId: slackChannelId,
  threadId,
  userId,
  text,
  messageTs,
  isMention,
  images,
  say,
  client,
}: HandleMessageParams) {
  const resolvedChannelId = await resolveChannel(slackChannelId);

  const rateLimit = await checkRateLimit(resolvedChannelId, userId);
  if (!rateLimit.allowed) {
    logger.info('Rate limited user', { channelId: resolvedChannelId, userId });
    await say({
      text: `:hourglass: You're sending messages too quickly. Please wait ${rateLimit.retryAfterSeconds}s and try again.`,
      thread_ts: threadId,
    });
    return;
  }

  if (!isMention) {
    const shouldSkip = await shouldSkipByReplyMode(
      resolvedChannelId,
      slackChannelId,
      threadId,
      userId,
      text,
      client,
    );
    if (shouldSkip) {
      logger.debug('Skipping message due to threadReplyMode filter', {
        channelId: resolvedChannelId,
        userId,
        threadId,
      });
      return;
    }
  }

  const budgetCheck = await orchestrator.checkBudget(resolvedChannelId);
  if (budgetCheck.exceeded) {
    logger.info('Budget exceeded, skipping engine run', {
      channelId: resolvedChannelId,
      todaySpend: budgetCheck.todaySpend,
      budget: budgetCheck.budget,
    });
    await say({
      text: `:warning: Daily cost budget exceeded ($${budgetCheck.todaySpend.toFixed(2)} / $${budgetCheck.budget?.toFixed(2)}). Please try again tomorrow or increase the budget in the dashboard.`,
      thread_ts: threadId,
    });
    return;
  }

  await addReaction(client, slackChannelId, messageTs);
  const adapter = new SlackAdapter(slackChannelId, say);

  try {
    await withThreadLock(threadId, async () => {
      await orchestrator.process({
        channelId: resolvedChannelId,
        threadId,
        userId,
        text,
        images,
        adapter,
      });
    });

    await removeReaction(client, slackChannelId, messageTs);
  } catch (error) {
    await removeReaction(client, slackChannelId, messageTs);

    if (error instanceof ApprovalDismissedError) {
      logger.info('Approval dismissed by new message', {
        channelId: resolvedChannelId,
        userId,
        threadId,
      });
      return;
    }

    if (APICallError.isInstance(error)) {
      const status = (error as { statusCode?: number }).statusCode;
      logger.error('AI provider API error', {
        channelId: resolvedChannelId,
        userId,
        ...errorDetails(error),
      });

      const userMessage =
        status === 401 || status === 403
          ? ":warning: I couldn't process your message — the AI provider rejected the API credentials. Please check the provider configuration."
          : `:warning: I ran into an issue talking to the AI provider (HTTP ${status}). Please try again shortly.`;

      await say({ text: userMessage, thread_ts: threadId });
      return;
    }

    logger.error('Unhandled error in message handler', {
      channelId: resolvedChannelId,
      userId,
      ...errorDetails(error),
    });
    await say({
      text: ':x: Something went wrong while processing your message. Please try again later.',
      thread_ts: threadId,
    });
  }
}

async function shouldSkipByReplyMode(
  channelId: string,
  slackChannelId: string,
  threadId: string,
  userId: string,
  text: string,
  client: SlackConversationsClient,
): Promise<boolean> {
  const row = await getCachedConfig(channelId);
  const parsed = threadReplyModeSchema.safeParse(row?.threadReplyMode);
  const mode: ThreadReplyMode = parsed.success ? parsed.data : 'all';
  if (mode === 'all') return false;

  if (mode === 'mentions_only') {
    const botUserId = config.SLACK_BOT_USER_ID;
    return !botUserId || !text.includes(`<@${botUserId}>`);
  }

  if (mode === 'original_poster') {
    try {
      const result = await client.conversations.replies({
        channel: slackChannelId,
        ts: threadId,
        limit: 1,
        inclusive: true,
      });
      const parentUser = result.messages?.[0]?.user;
      return parentUser !== userId;
    } catch {
      logger.warn('Failed to fetch thread parent for original_poster mode, allowing message');
      return false;
    }
  }

  return false;
}
