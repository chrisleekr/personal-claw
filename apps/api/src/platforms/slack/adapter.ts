import type { SayFn } from '@slack/bolt';
import type { ChannelAdapter } from '../../channels/adapter';
import { requestApproval, requestBatchApproval, requestPlanApproval } from './approvals';
import { chunkMessage, SLACK_MAX_MESSAGE_LENGTH } from './message-utils';
import { markdownToSlackMrkdwn } from './mrkdwn';

export class SlackAdapter implements ChannelAdapter {
  constructor(
    private channelId: string,
    private say: SayFn,
  ) {}

  async sendMessage(threadId: string, text: string): Promise<void> {
    const mrkdwn = markdownToSlackMrkdwn(text);
    const chunks = chunkMessage(mrkdwn, SLACK_MAX_MESSAGE_LENGTH);

    for (const chunk of chunks) {
      await this.say({ text: chunk, thread_ts: threadId });
    }
  }

  async requestApproval(params: {
    threadId: string;
    toolName: string;
    args: Record<string, unknown>;
  }): Promise<boolean> {
    return requestApproval({
      channelId: this.channelId,
      threadTs: params.threadId,
      toolName: params.toolName,
      args: params.args,
      say: this.say,
    });
  }

  async requestBatchApproval(params: {
    threadId: string;
    tools: Array<{ toolName: string; args: Record<string, unknown> }>;
  }): Promise<boolean> {
    return requestBatchApproval({
      channelId: this.channelId,
      threadTs: params.threadId,
      tools: params.tools,
      say: this.say,
    });
  }

  async requestPlanApproval(params: {
    threadId: string;
    planSummary: string;
    steps: string[];
  }): Promise<boolean> {
    return requestPlanApproval({
      channelId: this.channelId,
      threadTs: params.threadId,
      planSummary: params.planSummary,
      steps: params.steps,
      say: this.say,
    });
  }

  formatMentions(userIds: string[]): string {
    if (userIds.length === 0) return '';
    return userIds.map((id) => `<@${id}>`).join(' ');
  }
}
