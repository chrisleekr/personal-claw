import { describe, expect, mock, test } from 'bun:test';

mock.module('../mrkdwn', () => ({
  markdownToSlackMrkdwn: (text: string) => text,
}));

import { SlackWebApiAdapter } from '../web-adapter';

describe('SlackWebApiAdapter', () => {
  const mockPostMessage = mock(async () => ({}));
  const mockClient = {
    chat: { postMessage: mockPostMessage },
  } as unknown as import('@slack/bolt').AllMiddlewareArgs['client'];

  test('sendMessage posts via Web API', async () => {
    const adapter = new SlackWebApiAdapter(mockClient, 'C999');
    await adapter.sendMessage('thread-1', 'Hello');
    expect(mockPostMessage).toHaveBeenCalledWith({
      channel: 'C999',
      text: 'Hello',
    });
  });

  test('formatMentions formats user IDs', () => {
    const adapter = new SlackWebApiAdapter(mockClient, 'C999');
    expect(adapter.formatMentions(['U1', 'U2'])).toBe('<@U1> <@U2>');
    expect(adapter.formatMentions([])).toBe('');
  });

  test('requestApproval always returns true', async () => {
    const adapter = new SlackWebApiAdapter(mockClient, 'C999');
    const result = await adapter.requestApproval();
    expect(result).toBe(true);
  });

  test('requestPlanApproval always returns true', async () => {
    const adapter = new SlackWebApiAdapter(mockClient, 'C999');
    const result = await adapter.requestPlanApproval();
    expect(result).toBe(true);
  });
});
