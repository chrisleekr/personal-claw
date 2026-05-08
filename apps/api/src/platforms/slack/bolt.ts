import { getLogger } from '@logtape/logtape';
import {
  type AllMiddlewareArgs,
  App,
  type BlockAction,
  LogLevel,
  type SlackActionMiddlewareArgs,
} from '@slack/bolt';
import { autoRegisterChannel } from '../../channels/auto-register';
import { ChannelNotFoundError, ChannelResolver } from '../../channels/resolver';
import { config } from '../../config';
import { dismissPendingApprovals, handleApprovalAction } from './approvals';
import { classifyReaction, handleReactionFeedback } from './feedback';
import { handleMessage } from './handlers';
import { downloadImages, extractImageRefs } from './media';
import { handleSlashCommand } from './slash-commands';

const logger = getLogger(['personalclaw', 'slack', 'bolt']);

let slackApp: App | null = null;

export async function initSlackBot() {
  if (!config.SLACK_BOT_TOKEN || !config.SLACK_APP_TOKEN) {
    logger.warn`Slack tokens not configured, skipping bot initialization`;
    return;
  }

  slackApp = new App({
    token: config.SLACK_BOT_TOKEN,
    appToken: config.SLACK_APP_TOKEN,
    socketMode: true,
    logLevel: LogLevel.INFO,
  });

  slackApp.message(async ({ message, say, client }) => {
    if ('bot_id' in message && message.bot_id) return;

    const hasText = 'text' in message && message.text;
    const hasFiles = 'files' in message && Array.isArray(message.files) && message.files.length > 0;
    if (!hasText && !hasFiles) return;

    const text = (hasText ? message.text?.trim() : '') || '';
    const threadId = ('thread_ts' in message ? message.thread_ts : undefined) ?? message.ts;

    logger.debug('Incoming Slack message', {
      channel: message.channel,
      threadId,
      userId: 'user' in message ? message.user : undefined,
      text,
      fileCount: hasFiles ? (message as { files: unknown[] }).files.length : 0,
    });

    if (text.startsWith('/pclaw ')) {
      const slackUserId = 'user' in message ? (message.user as string) : '';
      if (!slackUserId) {
        await say({ text: 'Unable to identify user. Please try again.', thread_ts: threadId });
        return;
      }
      await handleSlashCommand({
        text,
        threadTs: threadId,
        channelId: message.channel,
        userId: slackUserId,
        say,
      });
      return;
    }

    await dismissPendingApprovals(threadId, client);

    const imageRefs = hasFiles
      ? extractImageRefs(message as { files?: Array<{ mimetype: string; url_private: string }> })
      : [];

    const images =
      imageRefs.length > 0 && config.SLACK_BOT_TOKEN
        ? await downloadImages(imageRefs, config.SLACK_BOT_TOKEN).catch((err) => {
            logger.warn('Failed to download Slack images', {
              channel: message.channel,
              error: (err as Error).message,
            });
            return [];
          })
        : [];

    await handleMessage({
      channelId: message.channel,
      threadId,
      userId: 'user' in message ? (message.user ?? '') : '',
      text: text || (images.length > 0 ? '[Image attached]' : ''),
      messageTs: message.ts,
      isMention: false,
      images: images.length > 0 ? images : undefined,
      say,
      client,
    });
  });

  slackApp.event('app_mention', async ({ event, say, client }) => {
    const threadId = event.thread_ts ?? event.ts;
    const hasFiles = 'files' in event && Array.isArray(event.files) && event.files.length > 0;

    logger.debug('Incoming Slack app_mention', {
      channel: event.channel,
      threadId,
      userId: event.user,
      text: event.text,
      fileCount: hasFiles ? (event as { files: unknown[] }).files.length : 0,
    });

    await dismissPendingApprovals(threadId, client);

    const imageRefs = hasFiles
      ? extractImageRefs(event as { files?: Array<{ mimetype: string; url_private: string }> })
      : [];

    const images =
      imageRefs.length > 0 && config.SLACK_BOT_TOKEN
        ? await downloadImages(imageRefs, config.SLACK_BOT_TOKEN).catch((err) => {
            logger.warn('Failed to download Slack images', {
              channel: event.channel,
              error: (err as Error).message,
            });
            return [];
          })
        : [];

    await handleMessage({
      channelId: event.channel,
      threadId,
      userId: event.user ?? '',
      text: event.text,
      messageTs: event.ts,
      isMention: true,
      images: images.length > 0 ? images : undefined,
      say,
      client,
    });
  });

  slackApp.action(/^approval_/, async (args) => {
    await handleApprovalAction(
      args as unknown as SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs,
    );
  });

  slackApp.action(/^plan_/, async (args) => {
    await handleApprovalAction(
      args as unknown as SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs,
    );
  });

  slackApp.action(/^batch_/, async (args) => {
    await handleApprovalAction(
      args as unknown as SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs,
    );
  });

  slackApp.event('reaction_added', async ({ event }) => {
    if (!classifyReaction(event.reaction)) return;

    const botUserId = config.SLACK_BOT_USER_ID;
    if (botUserId && event.item_user !== botUserId) return;

    if (event.item.type !== 'message') return;

    const slackChannelId = event.item.channel;
    const threadId = event.item.ts;
    const resolver = ChannelResolver.getInstance();

    let resolvedChannelId: string;
    try {
      const channel = await resolver.resolve('slack', slackChannelId);
      resolvedChannelId = channel.id;
    } catch (error) {
      if (error instanceof ChannelNotFoundError) {
        const channel = await autoRegisterChannel('slack', slackChannelId);
        resolvedChannelId = channel.id;
      } else {
        logger.error('Failed to resolve channel for reaction feedback', {
          channel: slackChannelId,
          error: (error as Error).message,
        });
        return;
      }
    }

    await handleReactionFeedback(resolvedChannelId, threadId, event.reaction, event.user);
  });

  await slackApp.start();
  logger.info`Slack bot connected via Socket Mode`;
}

export function getSlackApp() {
  return slackApp;
}
