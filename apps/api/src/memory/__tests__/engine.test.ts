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
