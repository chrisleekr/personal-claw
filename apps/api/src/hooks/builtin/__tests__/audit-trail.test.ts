import { describe, expect, mock, test } from 'bun:test';

let registeredHandler: ((ctx: unknown) => Promise<void>) | null = null;

mock.module('../../engine', () => ({
  HooksEngine: {
    getInstance: () => ({
      on: (_event: string, handler: (ctx: unknown) => Promise<void>) => {
        registeredHandler = handler;
      },
      emit: async () => ({ successCount: 0, errors: [] }),
    }),
  },
}));

mock.module('../../../config', () => ({
  config: { TRANSCRIPT_DIR: '/tmp/test-transcripts' },
}));

// Mutable mocks so individual tests can swap behavior.
let mkdirImpl: () => Promise<void> = async () => {};
let appendFileImpl: () => Promise<void> = async () => {};

mock.module('node:fs/promises', () => ({
  mkdir: () => mkdirImpl(),
  appendFile: () => appendFileImpl(),
}));

describe('audit-trail hook', () => {
  test('registers a message:sent handler on import', async () => {
    await import('../audit-trail');
    expect(registeredHandler).not.toBeNull();
  });

  test('handler writes transcript entry without throwing', async () => {
    mkdirImpl = async () => {};
    appendFileImpl = async () => {};
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

  test('fs errors with errno are caught (NodeJS.ErrnoException)', async () => {
    mkdirImpl = async () => {
      const err = Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      throw err;
    };
    appendFileImpl = async () => {};
    await import('../audit-trail');
    if (!registeredHandler) throw new Error('Handler not registered');
    // Errno-style error is the only category the handler is allowed to swallow per FR-029.
    await expect(
      registeredHandler({
        channelId: 'ch-1',
        externalUserId: 'user-1',
        threadId: 'thread-1',
        eventType: 'message:sent',
        payload: { text: 'Hello' },
      }),
    ).resolves.toBeUndefined();
  });

  test('non-errno errors bubble out of the handler (FR-029, FR-017)', async () => {
    mkdirImpl = async () => {};
    appendFileImpl = async () => {
      throw new TypeError('totally unexpected non-fs error');
    };
    await import('../audit-trail');
    if (!registeredHandler) throw new Error('Handler not registered');
    // Non-errno errors must NOT be silently swallowed.
    await expect(
      registeredHandler({
        channelId: 'ch-1',
        externalUserId: 'user-1',
        threadId: 'thread-1',
        eventType: 'message:sent',
        payload: { text: 'Hello' },
      }),
    ).rejects.toThrow('totally unexpected non-fs error');
  });
});
