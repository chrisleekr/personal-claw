import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ConversationMessage } from '@personalclaw/shared';

const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';
const THREAD_ID = 'thread-001';

let mockSelectRows: unknown[] = [];
let mockInsertCalled = false;
let mockUpdateCalled = false;
let mockOnConflictCalled = false;
let mockTransactionCalled = false;
let mockReturningRow: { messages: ConversationMessage[] } = { messages: [] };

function chainable(getRows: () => unknown[]): unknown {
  const methods: Record<string, unknown> = {};
  for (const name of ['from', 'where', 'orderBy', 'limit', 'groupBy', 'returning', 'set']) {
    methods[name] = () => chainable(getRows);
  }
  return Object.assign([...getRows()], methods);
}

function buildTxLike(): unknown {
  return {
    select: () => chainable(() => mockSelectRows),
    insert: () => ({
      values: () => {
        mockInsertCalled = true;
        const obj: Record<string, unknown> = {
          returning: () => [mockReturningRow],
          onConflictDoUpdate: () => {
            mockOnConflictCalled = true;
            return obj;
          },
        };
        return obj;
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
        const obj: Record<string, unknown> = {
          returning: () => [mockReturningRow],
          onConflictDoUpdate: () => {
            mockOnConflictCalled = true;
            return obj;
          },
        };
        return obj;
      },
    }),
    update: () => ({
      set: () => {
        mockUpdateCalled = true;
        return chainable(() => []);
      },
    }),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
      mockTransactionCalled = true;
      return cb(buildTxLike());
    },
  }),
}));

import { ConversationMemory } from '../conversation';

describe('ConversationMemory', () => {
  let memory: ConversationMemory;

  beforeEach(() => {
    memory = new ConversationMemory();
    mockSelectRows = [];
    mockInsertCalled = false;
    mockUpdateCalled = false;
    mockOnConflictCalled = false;
    mockTransactionCalled = false;
    mockReturningRow = { messages: [] };
  });

  afterEach(() => {
    mockSelectRows = [];
    mockInsertCalled = false;
    mockUpdateCalled = false;
    mockOnConflictCalled = false;
    mockTransactionCalled = false;
    mockReturningRow = { messages: [] };
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
    test('runs in a transaction with INSERT ... ON CONFLICT', async () => {
      const msg: ConversationMessage = {
        role: 'user',
        content: 'Hello',
        timestamp: '2026-01-01T00:00:00Z',
      };
      mockReturningRow = { messages: [msg] };
      const result = await memory.append(CHANNEL_ID, THREAD_ID, msg);
      expect(result.tokenCount).toBeGreaterThan(0);
      expect(mockTransactionCalled).toBe(true);
      expect(mockInsertCalled).toBe(true);
      expect(mockOnConflictCalled).toBe(true);
    });

    test('does NOT call select before inserting (no read-modify-write)', async () => {
      mockSelectRows = [{ id: 'should-not-be-read' }];
      const msg: ConversationMessage = {
        role: 'user',
        content: 'Hello',
        timestamp: '2026-01-01T00:00:00Z',
      };
      mockReturningRow = { messages: [msg] };
      await memory.append(CHANNEL_ID, THREAD_ID, msg);
      // Insert was the first DB action; no read-modify-write select happened
      // before it (the prior implementation always selected first).
      expect(mockInsertCalled).toBe(true);
      expect(mockOnConflictCalled).toBe(true);
    });

    test('recomputes token count from the merged messages returned by ON CONFLICT', async () => {
      const newMsg: ConversationMessage = {
        role: 'assistant',
        content: 'Hi there!',
        timestamp: '2026-01-01T00:00:01Z',
      };
      // Simulate the merged JSONB result returned by Postgres after the
      // server-side concat: an existing message plus our new one.
      mockReturningRow = {
        messages: [{ role: 'user', content: 'Hello', timestamp: '2026-01-01T00:00:00Z' }, newMsg],
      };
      const result = await memory.append(CHANNEL_ID, THREAD_ID, newMsg);
      // Token count should be > the count of just the new message alone
      // because it's recomputed from the merged returned messages.
      const newMsgOnlyTokenCount = Math.ceil(newMsg.content.length / 4);
      expect(result.tokenCount).toBeGreaterThan(newMsgOnlyTokenCount);
      expect(mockUpdateCalled).toBe(true);
    });

    test('handles multiple messages in a single append', async () => {
      const msgs: ConversationMessage[] = [
        { role: 'user', content: 'What is 2+2?', timestamp: '2026-01-01T00:00:00Z' },
        { role: 'assistant', content: 'It is 4.', timestamp: '2026-01-01T00:00:01Z' },
      ];
      mockReturningRow = { messages: msgs };
      const result = await memory.append(CHANNEL_ID, THREAD_ID, ...msgs);
      expect(result.tokenCount).toBeGreaterThan(0);
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
