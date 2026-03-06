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

mock.module('../../../config', () => ({
  config: { TRANSCRIPT_DIR: '/tmp/test-transcripts' },
}));

mock.module('node:fs/promises', () => ({
  mkdir: async () => {},
  appendFile: async () => {},
}));

describe('audit-trail hook', () => {
  test('registers a message:sent handler on import', async () => {
    await import('../audit-trail');
    expect(registeredHandler).not.toBeNull();
  });

  test('handler writes transcript entry without throwing', async () => {
    await import('../audit-trail');
    if (!registeredHandler) throw new Error('Handler not registered');
    await expect(
      registeredHandler({
        channelId: 'ch-1',
        externalUserId: 'user-1',
        threadId: 'thread-1',
        eventType: 'message:sent',
        payload: { text: 'Hello world' },
      }),
    ).resolves.toBeUndefined();
  });
});
