import { describe, expect, mock, test } from 'bun:test';

let registeredHandler: ((ctx: unknown) => Promise<void>) | null = null;

mock.module('../../engine', () => ({
  HooksEngine: {
    getInstance: () => ({
      on: (_event: string, handler: (ctx: unknown) => Promise<void>) => {
        registeredHandler = handler;
      },
      emit: async () => {},
    }),
  },
}));

describe('cost-log hook', () => {
  test('registers a message:sent handler on import', async () => {
    await import('../cost-log');
    expect(registeredHandler).not.toBeNull();
  });

  test('handler does not throw when cost/tokens are present', async () => {
    await import('../cost-log');
    if (!registeredHandler) throw new Error('Handler not registered');
    await expect(
      registeredHandler({
        channelId: 'ch-1',
        externalUserId: 'user-1',
        threadId: 'thread-1',
        eventType: 'message:sent',
        payload: { cost: 0.0015, tokens: 500, model: 'claude-sonnet-4-20250514' },
      }),
    ).resolves.toBeUndefined();
  });

  test('handler does not throw when cost/tokens are absent', async () => {
    await import('../cost-log');
    if (!registeredHandler) throw new Error('Handler not registered');
    await expect(
      registeredHandler({
        channelId: 'ch-1',
        externalUserId: 'user-1',
        threadId: 'thread-1',
        eventType: 'message:sent',
        payload: {},
      }),
    ).resolves.toBeUndefined();
  });
});
