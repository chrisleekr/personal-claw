import { describe, expect, mock, test } from 'bun:test';

mock.module('../approvals', () => ({
  requestApproval: mock(async () => true),
  requestBatchApproval: mock(async () => false),
  requestPlanApproval: mock(async () => true),
}));

mock.module('../mrkdwn', () => ({
  markdownToSlackMrkdwn: (text: string) => text,
}));

import { SlackAdapter } from '../adapter';

describe('SlackAdapter', () => {
  const mockSay = mock(async () => ({ ts: '1234.5678' })) as unknown as import('@slack/bolt').SayFn;
  const CHANNEL_ID = 'C12345';

  test('sendMessage chunks and calls say for each chunk', async () => {
    const adapter = new SlackAdapter(CHANNEL_ID, mockSay);
    await adapter.sendMessage('thread-1', 'Hello world');
    expect(mockSay).toHaveBeenCalledWith({
      text: 'Hello world',
      thread_ts: 'thread-1',
    });
  });

  test('formatMentions formats user IDs as Slack mentions', () => {
    const adapter = new SlackAdapter(CHANNEL_ID, mockSay);
    expect(adapter.formatMentions(['U123', 'U456'])).toBe('<@U123> <@U456>');
  });

  test('formatMentions returns empty string for empty array', () => {
    const adapter = new SlackAdapter(CHANNEL_ID, mockSay);
    expect(adapter.formatMentions([])).toBe('');
  });

  test('requestApproval delegates to approvals module', async () => {
    const adapter = new SlackAdapter(CHANNEL_ID, mockSay);
    const result = await adapter.requestApproval({
      threadId: 'thread-1',
      toolName: 'test_tool',
      args: { key: 'value' },
    });
    expect(result).toBe(true);
  });

  test('requestPlanApproval delegates to approvals module', async () => {
    const adapter = new SlackAdapter(CHANNEL_ID, mockSay);
    const result = await adapter.requestPlanApproval({
      threadId: 'thread-1',
      planSummary: 'Deploy to prod',
      steps: ['Step 1', 'Step 2'],
    });
    expect(result).toBe(true);
  });
});
