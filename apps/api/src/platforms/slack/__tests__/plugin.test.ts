import { describe, expect, mock, test } from 'bun:test';

let mockSlackApp: unknown = null;

mock.module('../bolt', () => ({
  initSlackBot: async () => {},
  getSlackApp: () => mockSlackApp,
}));

import { slackPlugin } from '../plugin';

describe('slackPlugin', () => {
  test('has correct name', () => {
    expect(slackPlugin.name).toBe('slack');
  });

  test('init does not throw', async () => {
    await expect(slackPlugin.init()).resolves.toBeUndefined();
  });

  test('createAdapter returns NoOpAdapter when slack app is null', () => {
    mockSlackApp = null;
    const channel = { id: 'ch-1', platform: 'slack', externalId: 'C123' };
    const adapter = slackPlugin.createAdapter(channel as never);
    expect(adapter).toBeDefined();
    expect(typeof adapter.sendMessage).toBe('function');
  });

  test('createAdapter returns SlackWebApiAdapter when slack app is available', () => {
    mockSlackApp = {
      client: { chat: { postMessage: async () => ({}) } },
    };
    const channel = { id: 'ch-2', platform: 'slack', externalId: 'C456' };
    const adapter = slackPlugin.createAdapter(channel as never);
    expect(adapter).toBeDefined();
    expect(typeof adapter.sendMessage).toBe('function');
  });

  test('enrichChannelName returns null when slack app is null', async () => {
    mockSlackApp = null;
    const result = await slackPlugin.enrichChannelName?.('C123');
    expect(result).toBeNull();
  });
});
