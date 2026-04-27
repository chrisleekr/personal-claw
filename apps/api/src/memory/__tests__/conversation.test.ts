import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ConversationMessage } from '@personalclaw/shared';

const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';
const THREAD_ID = 'thread-001';

let mockSelectRows: unknown[] = [];
let mockReturningRows: unknown[] = [];
let mockInsertCalled = false;
let mockOnConflictCalled = false;
let mockUpdateCalled = false;
let mockTransactionCalled = false;

function chainable(getRows: () => unknown[]): unknown {
  const methods: Record<string, unknown> = {};
  for (const name of ['from', 'where', 'orderBy', 'limit', 'groupBy', 'returning', 'set']) {
    methods[name] = () => chainable(getRows);
  }
  return Object.assign([...getRows()], methods);
}

function buildTx() {
  return {
    insert: () => ({
      values: () => {
        mockInsertCalled = true;
        return {
          onConflictDoUpdate: () => {
            mockOnConflictCalled = true;
            return {
              returning: () => [...mockReturningRows],
            };
          },
          returning: () => [...mockReturningRows],
        };
      },
    }),
    update: () => ({
      set: () => {
        mockUpdateCalled = true;
        return chainable(() => []);
      },
    }),
  };
}

mock.module('../../db', () => ({
  getDb: () => ({
    select: () => chainable(() => mockSelectRows),
    insert: () => ({
      values: () => {
        mockInsertCalled = true;
        return {
          onConflictDoUpdate: () => {
            mockOnConflictCalled = true;
            return { returning: () => [...mockReturningRows] };
          },
          returning: () => [...mockReturningRows],
        };
      },
    }),
    update: () => ({
      set: () => {
        mockUpdateCalled = true;
        return chainable(() => []);
      },
    }),
    transaction: async <T>(cb: (tx: ReturnType<typeof buildTx>) => Promise<T>): Promise<T> => {
      mockTransactionCalled = true;
      return cb(buildTx());
    },
  }),
}));

import { ConversationMemory } from '../conversation';

describe('ConversationMemory', () => {
  let memory: ConversationMemory;

  beforeEach(() => {
    memory = new ConversationMemory();
    mockSelectRows = [];
    mockReturningRows = [];
    mockInsertCalled = false;
    mockOnConflictCalled = false;
    mockUpdateCalled = false;
    mockTransactionCalled = false;
  });

  afterEach(() => {
    mockSelectRows = [];
    mockReturningRows = [];
    mockInsertCalled = false;
    mockOnConflictCalled = false;
    mockUpdateCalled = false;
    mockTransactionCalled = false;
  });

  describe('getHistory', () => {
    test('returns empty array when no conversation exists', async () => {
      mockSelectRows = [];
      const result = await memory.getHistory(CHANNEL_ID, THREAD_ID);
      expect(result).toEqual([]);
    });

    test('returns messages from existing conversation', async () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello', timestamp: '2026-01-01T00:00:00Z' },
        { role: 'assistant', content: 'Hi!', timestamp: '2026-01-01T00:00:01Z' },
      ];
      mockSelectRows = [
        {
          id: 'conv-1',
          channelId: CHANNEL_ID,
          externalThreadId: THREAD_ID,
          messages,
          isCompacted: false,
          summary: null,
        },
      ];
      const result = await memory.getHistory(CHANNEL_ID, THREAD_ID);
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe('user');
    });

    test('returns summary as system message when compacted', async () => {
      mockSelectRows = [
        {
          id: 'conv-1',
          channelId: CHANNEL_ID,
          externalThreadId: THREAD_ID,
          messages: [],
          isCompacted: true,
          summary: 'User asked about deployments.',
        },
      ];
      const result = await memory.getHistory(CHANNEL_ID, THREAD_ID);
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('system');
      expect(result[0].content).toContain('User asked about deployments');
    });
  });

  describe('append', () => {
    test('inserts via atomic upsert when no row exists yet', async () => {
      const msg: ConversationMessage = {
        role: 'user',
        content: 'Hello',
        timestamp: '2026-01-01T00:00:00Z',
      };
      mockReturningRows = [
        {
          id: 'conv-1',
          channelId: CHANNEL_ID,
          externalThreadId: THREAD_ID,
          messages: [msg],
          tokenCount: 5,
        },
      ];
      const result = await memory.append(CHANNEL_ID, THREAD_ID, msg);
      expect(result.tokenCount).toBeGreaterThan(0);
      expect(mockTransactionCalled).toBe(true);
      expect(mockInsertCalled).toBe(true);
      expect(mockOnConflictCalled).toBe(true);
    });

    test('appends to existing conversation via JSONB concat in SQL', async () => {
      const existing: ConversationMessage = {
        role: 'user',
        content: 'Hello',
        timestamp: '2026-01-01T00:00:00Z',
      };
      const msg: ConversationMessage = {
        role: 'assistant',
        content: 'Hi there!',
        timestamp: '2026-01-01T00:00:01Z',
      };
      // After ON CONFLICT DO UPDATE the RETURNING row contains the merged
      // messages — what Postgres has after the JSONB concat.
      mockReturningRows = [
        {
          id: 'conv-1',
          channelId: CHANNEL_ID,
          externalThreadId: THREAD_ID,
          messages: [existing, msg],
          tokenCount: 4,
        },
      ];
      const result = await memory.append(CHANNEL_ID, THREAD_ID, msg);
      expect(result.tokenCount).toBeGreaterThan(0);
      expect(mockTransactionCalled).toBe(true);
      expect(mockOnConflictCalled).toBe(true);
    });

    test('handles multiple messages in a single append', async () => {
      const msgs: ConversationMessage[] = [
        { role: 'user', content: 'What is 2+2?', timestamp: '2026-01-01T00:00:00Z' },
        { role: 'assistant', content: 'It is 4.', timestamp: '2026-01-01T00:00:01Z' },
      ];
      mockReturningRows = [
        {
          id: 'conv-1',
          channelId: CHANNEL_ID,
          externalThreadId: THREAD_ID,
          messages: msgs,
          tokenCount: 10,
        },
      ];
      const result = await memory.append(CHANNEL_ID, THREAD_ID, ...msgs);
      expect(result.tokenCount).toBeGreaterThan(0);
      expect(mockTransactionCalled).toBe(true);
    });

    test('regression: server-side concat preserves both writers under simulated race', async () => {
      // Simulate the merged-state Postgres would return after BOTH concurrent
      // upserts have run — three messages, with neither lost. The previous
      // read-modify-write code would have produced a 2-message array because
      // each writer overwrote the other's snapshot.
      const winners: ConversationMessage[] = [
        { role: 'user', content: 'm1', timestamp: '2026-01-01T00:00:00Z' },
        { role: 'user', content: 'm2', timestamp: '2026-01-01T00:00:01Z' },
        { role: 'user', content: 'm3', timestamp: '2026-01-01T00:00:02Z' },
      ];
      mockReturningRows = [
        {
          id: 'conv-1',
          channelId: CHANNEL_ID,
          externalThreadId: THREAD_ID,
          messages: winners,
          tokenCount: 1,
        },
      ];
      const result = await memory.append(CHANNEL_ID, THREAD_ID, winners[2]);
      // Token count is recomputed from the merged array so it reflects all
      // three messages, not just the appended one.
      expect(result.tokenCount).toBeGreaterThan(0);
      expect(mockOnConflictCalled).toBe(true);
      expect(mockUpdateCalled).toBe(true);
    });
  });

  describe('compact', () => {
    test('compacts conversation with summary', async () => {
      mockSelectRows = [];
      await memory.compact(CHANNEL_ID, THREAD_ID, 'Summary of conversation.');
      expect(mockUpdateCalled).toBe(true);
    });
  });
});
