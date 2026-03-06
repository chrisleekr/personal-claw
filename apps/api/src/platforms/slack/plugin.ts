import { getLogger } from '@logtape/logtape';
import type { ChannelAdapter } from '../../channels/adapter';
import { NoOpAdapter } from '../../channels/no-op-adapter';
import type { ChannelRecord, PlatformPlugin } from '../types';
import { getSlackApp, initSlackBot } from './bolt';
import { SlackWebApiAdapter } from './web-adapter';

const logger = getLogger(['personalclaw', 'platforms', 'slack']);

export const slackPlugin: PlatformPlugin = {
  name: 'slack',

  async init(): Promise<void> {
    await initSlackBot();
  },

  createAdapter(channel: ChannelRecord): ChannelAdapter {
    const app = getSlackApp();
    if (!app) {
      logger.warn`Slack app not initialised, falling back to NoOpAdapter for channel=${channel.id}`;
      return new NoOpAdapter();
    }
    return new SlackWebApiAdapter(app.client, channel.externalId);
  },

  async enrichChannelName(externalId: string): Promise<string | null> {
    const app = getSlackApp();
    if (!app) return null;

    try {
      const res = await app.client.conversations.info({ channel: externalId });
      return res.channel?.name ?? null;
    } catch (error) {
      logger.warn('Failed to fetch Slack channel name', {
        externalId,
        error: (error as Error).message,
      });
      return null;
    }
  },
};
