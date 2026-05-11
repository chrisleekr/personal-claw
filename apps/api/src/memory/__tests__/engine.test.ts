import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ConversationMessage } from '@personalclaw/shared';

const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';
const THREAD_ID = 'thread-001';

let mockSelectRows: unknown[] = [];
let mockInsertCalled = false;
let _mockUpdateCalled = false;
let mockRedisStore: Record<string, string> = {};
let mockExecuteRows: unknown[] = [];

function chainable(getRows: () => unknown[]): unknown {
  const methods: Record<string, unknown> = {};
  for (const name of ['from', 'where', 'orderBy', 'limit', 'groupBy', 'returning', 'set']) {
    methods[name] = () => chainable(getRows);
  }
  return Object.assign([...getRows()], methods);
}

function buildDbLike(): unknown {
  return {
    select: () => chainable(() => mockSelectRows),
    insert: () => ({
      values: () => {
        mockInsertCalled = true;
        const obj: Record<string, unknown> = {
          // xmax: '0' = fresh insert path (no conflict). MemoryEngine callers
          // exercise ConversationMemory.append, which now branches on xmax.
          returning: () => [{ messages: [], xmax: '0' }],
          onConflictDoUpdate: () => {
            return obj;
          },
          onConflictDoNothing: () => obj,
        };
        return obj;
      },
    }),
    update: () => ({
      set: () => {
        _mockUpdateCalled = true;
        return chainable(() => []);
      },
    }),
    execute: async () => mockExecuteRows,
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb(buildDbLike()),
  };
}

mock.module('../../db', () => ({
  getDb: () => buildDbLike(),
}));

mock.module('../../redis', () => ({
  isRedisAvailable: () => false,
  getRedis: () => ({
    get: async (key: string) => mockRedisStore[key] ?? null,
    set: async (key: string, value: string) => {
      mockRedisStore[key] = value;
    },
    del: async (key: string) => {
      delete mockRedisStore[key];
    },
  }),
}));

mock.module('../embeddings', () => ({
  generateEmbedding: async () => Array.from({ length: 1024 }, () => 0.1),
}));

// Configurable generateText mock for the triggerCompaction wall-clock test.
// Default resolves immediately so unrelated tests are unaffected.
let mockGenerateTextImpl: (opts: { abortSignal?: AbortSignal }) => Promise<{ text: string }> = () =>
  Promise.resolve({ text: 'summary' });

mock.module('ai', () => ({
  generateText: (opts: { abortSignal?: AbortSignal }) => mockGenerateTextImpl(opts),
  stepCountIs: () => ({}),
}));

mock.module('../../agent/provider', () => ({
  getProvider: async () => ({
    provider: () => ({}),
    model: 'test-model',
  }),
}));

mock.module('../tools', () => ({
  getMemoryTools: () => ({}),
}));

import { MemoryEngine } from '../engine';

describe('MemoryEngine', () => {
  let engine: MemoryEngine;

  beforeEach(() => {
    engine = new MemoryEngine();
    mockSelectRows = [];
    mockInsertCalled = false;
    _mockUpdateCalled = false;
    mockRedisStore = {};
    mockExecuteRows = [];
  });

  afterEach(() => {
    mockSelectRows = [];
    mockInsertCalled = false;
    _mockUpdateCalled = false;
    mockRedisStore = {};
    mockExecuteRows = [];
  });

  describe('assembleContext', () => {
    test('returns empty messages and memories when no data exists', async () => {
      mockSelectRows = [];
      mockExecuteRows = [];
      const result = await engine.assembleContext(CHANNEL_ID, THREAD_ID);
      expect(result.messages).toEqual([]);
      expect(result.memories).toEqual([]);
    });

    test('returns conversation messages from DB', async () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello', timestamp: '2026-01-01T00:00:00Z' },
      ];
      mockSelectRows = [
        {
          id: 'conv-1',
          channelId: CHANNEL_ID,
          externalThreadId: THREAD_ID,
          messages,
          isCompacted: false,
          summary: null,
          memoryConfig: null,
        },
      ];
      mockExecuteRows = [];
      const result = await engine.assembleContext(CHANNEL_ID, THREAD_ID);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('Hello');
    });
  });

  describe('persistUserMessage', () => {
    test('appends user message to conversation', async () => {
      mockSelectRows = [];
      const msg: ConversationMessage = {
        role: 'user',
        content: 'Hello',
        timestamp: '2026-01-01T00:00:00Z',
      };
      await engine.persistUserMessage(CHANNEL_ID, THREAD_ID, msg);
      expect(mockInsertCalled).toBe(true);
    });
  });

  describe('persistConversation', () => {
    test('appends both user and assistant messages', async () => {
      mockSelectRows = [];
      const userMsg: ConversationMessage = {
        role: 'user',
        content: 'What is TypeScript?',
        timestamp: '2026-01-01T00:00:00Z',
      };
      const assistantMsg: ConversationMessage = {
        role: 'assistant',
        content: 'TypeScript is a typed superset of JavaScript.',
        timestamp: '2026-01-01T00:00:01Z',
      };
      await engine.persistConversation(CHANNEL_ID, THREAD_ID, userMsg, assistantMsg);
      expect(mockInsertCalled).toBe(true);
    });

    test('does not block on triggerCompaction when conversation crosses threshold', async () => {
      mockSelectRows = [];

      // Build messages large enough to cross COMPACTION_TOKEN_THRESHOLD.
      // estimateTokenCount = ceil(len/4); >= 80000 tokens needs >= 320000 chars
      // across the joined messages.
      const userMsg: ConversationMessage = {
        role: 'user',
        content: 'a'.repeat(160_001),
        timestamp: '2026-01-01T00:00:00Z',
      };
      const assistantMsg: ConversationMessage = {
        role: 'assistant',
        content: 'b'.repeat(160_001),
        timestamp: '2026-01-01T00:00:01Z',
      };

      // Replace triggerCompaction with a never-resolving stub. If the
      // production code awaits it, persistConversation will hang and the
      // test will time out. Fire-and-forget means we return promptly.
      let triggerCalled = false;
      let releaseTrigger: () => void = () => {};
      const triggerPromise = new Promise<void>((resolve) => {
        releaseTrigger = resolve;
      });
      (engine as unknown as { triggerCompaction: () => Promise<void> }).triggerCompaction =
        async () => {
          triggerCalled = true;
          await triggerPromise;
        };

      const start = Date.now();
      await engine.persistConversation(CHANNEL_ID, THREAD_ID, userMsg, assistantMsg);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(500);
      expect(triggerCalled).toBe(true);

      // Release the hanging promise so we don't leak.
      releaseTrigger();
    });

    test('does not stack a second compaction while one is already in flight for the same thread', async () => {
      mockSelectRows = [];

      const userMsg: ConversationMessage = {
        role: 'user',
        content: 'a'.repeat(160_001),
        timestamp: '2026-01-01T00:00:00Z',
      };
      const assistantMsg: ConversationMessage = {
        role: 'assistant',
        content: 'b'.repeat(160_001),
        timestamp: '2026-01-01T00:00:01Z',
      };

      let triggerCalls = 0;
      let releaseTrigger: () => void = () => {};
      const triggerPromise = new Promise<void>((resolve) => {
        releaseTrigger = resolve;
      });
      (engine as unknown as { triggerCompaction: () => Promise<void> }).triggerCompaction =
        async () => {
          triggerCalls += 1;
          await triggerPromise;
        };

      // Two persistConversation calls for the same (channel, thread). The
      // first launches a fire-and-forget compaction; the second must observe
      // the in-flight entry and skip launching its own.
      await engine.persistConversation(CHANNEL_ID, THREAD_ID, userMsg, assistantMsg);
      await engine.persistConversation(CHANNEL_ID, THREAD_ID, userMsg, assistantMsg);

      expect(triggerCalls).toBe(1);

      releaseTrigger();
      // Yield so the .finally on the in-flight promise drains the map before
      // the test exits.
      await Bun.sleep(10);
    });

    describe('triggerCompaction wall-clock timeout', () => {
      const ORIGINAL_TIMEOUT = process.env.MEMORY_COMPACTION_TIMEOUT_MS;

      beforeEach(() => {
        mockGenerateTextImpl = () => Promise.resolve({ text: 'summary' });
      });

      afterEach(() => {
        // Always restore the env var, even if assertions above throw, so a
        // mutated MEMORY_COMPACTION_TIMEOUT_MS does not leak into other tests
        // via Bun's shared process.env.
        if (ORIGINAL_TIMEOUT === undefined) {
          delete process.env.MEMORY_COMPACTION_TIMEOUT_MS;
        } else {
          process.env.MEMORY_COMPACTION_TIMEOUT_MS = ORIGINAL_TIMEOUT;
        }
        mockGenerateTextImpl = () => Promise.resolve({ text: 'summary' });
      });

      test('aborts a stalled summarisation LLM call within the configured budget', async () => {
        process.env.MEMORY_COMPACTION_TIMEOUT_MS = '100';

        // Mimic an SDK that respects abortSignal: hang until the controller
        // aborts, then reject with AbortError. Without the wall-clock fix,
        // this promise would never settle and pin compactionsInFlight forever.
        mockGenerateTextImpl = (opts) =>
          new Promise((_, reject) => {
            opts.abortSignal?.addEventListener('abort', () => {
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
            });
          });

        const history = [
          {
            role: 'user' as const,
            content: 'hi',
            timestamp: '2026-01-01T00:00:00Z',
          },
        ];

        const start = Date.now();
        // Should resolve cleanly (not throw) within the budget — the abort
        // branch returns void so the .finally in persistConversation can
        // release the in-flight slot.
        await expect(
          engine.triggerCompaction(CHANNEL_ID, THREAD_ID, history),
        ).resolves.toBeUndefined();
        const elapsed = Date.now() - start;

        expect(elapsed).toBeLessThan(1000);
      });

      test('releases the in-flight slot after a wall-clock abort so the next persistConversation can re-trigger', async () => {
        process.env.MEMORY_COMPACTION_TIMEOUT_MS = '100';

        mockGenerateTextImpl = (opts) =>
          new Promise((_, reject) => {
            opts.abortSignal?.addEventListener('abort', () => {
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
            });
          });

        const userMsg: ConversationMessage = {
          role: 'user',
          content: 'a'.repeat(160_001),
          timestamp: '2026-01-01T00:00:00Z',
        };
        const assistantMsg: ConversationMessage = {
          role: 'assistant',
          content: 'b'.repeat(160_001),
          timestamp: '2026-01-01T00:00:01Z',
        };

        // First persistConversation kicks off the real triggerCompaction; the
        // abort fires at ~100ms.
        await engine.persistConversation(CHANNEL_ID, THREAD_ID, userMsg, assistantMsg);

        // Wait for the fire-and-forget chain (.catch().finally()) to drain
        // the compactionsInFlight entry.
        await Bun.sleep(250);

        // Patch triggerCompaction now so the SECOND call uses a sentinel we
        // can count. If the in-flight slot were leaked, the guard would
        // short-circuit and `secondCalls` would stay 0.
        let secondCalls = 0;
        (engine as unknown as { triggerCompaction: () => Promise<void> }).triggerCompaction =
          async () => {
            secondCalls += 1;
          };

        await engine.persistConversation(CHANNEL_ID, THREAD_ID, userMsg, assistantMsg);
        // Allow .finally on the second call to run.
        await Bun.sleep(20);

        expect(secondCalls).toBe(1);
      });
    });

    test('does not propagate triggerCompaction errors', async () => {
      mockSelectRows = [];

      const userMsg: ConversationMessage = {
        role: 'user',
        content: 'a'.repeat(160_001),
        timestamp: '2026-01-01T00:00:00Z',
      };
      const assistantMsg: ConversationMessage = {
        role: 'assistant',
        content: 'b'.repeat(160_001),
        timestamp: '2026-01-01T00:00:01Z',
      };

      (engine as unknown as { triggerCompaction: () => Promise<void> }).triggerCompaction =
        async () => {
          throw new Error('compaction failed');
        };

      await expect(
        engine.persistConversation(CHANNEL_ID, THREAD_ID, userMsg, assistantMsg),
      ).resolves.toBeUndefined();

      // Allow the .catch handler to run so the unhandled rejection (if any)
      // would have surfaced before the test ends.
      await Bun.sleep(10);
    });
  });
});
