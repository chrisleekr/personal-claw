import type { AllMiddlewareArgs } from '@slack/bolt';
import type { ChannelAdapter } from '../../channels/adapter';
import { chunkMessage, SLACK_MAX_MESSAGE_LENGTH } from './message-utils';
import { markdownToSlackMrkdwn } from './mrkdwn';

type SlackWebClient = AllMiddlewareArgs['client'];

/**
 * Slack adapter that posts via the Web API client (chat.postMessage).
 *
 * Unlike {@link SlackAdapter} which relies on Bolt's `SayFn` (only available
 * inside event handlers), this adapter can be used from any context -- cron
 * jobs, heartbeats, or scheduled tasks.
 */
export class SlackWebApiAdapter implements ChannelAdapter {
  constructor(
    private client: SlackWebClient,
    private slackChannelId: string,
  ) {}

  async sendMessage(_threadId: string, text: string): Promise<void> {
    const mrkdwn = markdownToSlackMrkdwn(text);
    const chunks = chunkMessage(mrkdwn, SLACK_MAX_MESSAGE_LENGTH);

    for (const chunk of chunks) {
      await this.client.chat.postMessage({
        channel: this.slackChannelId,
        text: chunk,
      });
    }
  }

  formatMentions(userIds: string[]): string {
    if (userIds.length === 0) return '';
    return userIds.map((id) => `<@${id}>`).join(' ');
  }

  async requestApproval(): Promise<boolean> {
    return true;
  }

  async requestPlanApproval(): Promise<boolean> {
    return true;
  }
}
