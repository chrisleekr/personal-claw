import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ConversationMessage } from '@personalclaw/shared';

const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';
const THREAD_ID = 'thread-001';

let mockSelectRows: unknown[] = [];
let mockInsertCalled = false;
let mockUpdateCalled = false;

function chainable(getRows: () => unknown[]): unknown {
  const methods: Record<string, unknown> = {};
  for (const name of ['from', 'where', 'orderBy', 'limit', 'groupBy', 'returning', 'set']) {
    methods[name] = () => chainable(getRows);
  }
  return Object.assign([...getRows()], methods);
}

mock.module('../../db', () => ({
  getDb: () => ({
    select: () => chainable(() => mockSelectRows),
    insert: () => ({
      values: () => {
        mockInsertCalled = true;
        return { returning: () => [] };
      },
    }),
    update: () => ({
      set: () => {
        mockUpdateCalled = true;
        return chainable(() => []);
      },
    }),
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
  });

  afterEach(() => {
    mockSelectRows = [];
    mockInsertCalled = false;
    mockUpdateCalled = false;
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
    test('creates new conversation when none exists', async () => {
      mockSelectRows = [];
      const msg: ConversationMessage = {
        role: 'user',
        content: 'Hello',
        timestamp: '2026-01-01T00:00:00Z',
      };
      const result = await memory.append(CHANNEL_ID, THREAD_ID, msg);
      expect(result.tokenCount).toBeGreaterThan(0);
      expect(mockInsertCalled).toBe(true);
    });

    test('appends to existing conversation', async () => {
      mockSelectRows = [
        {
          id: 'conv-1',
          channelId: CHANNEL_ID,
          externalThreadId: THREAD_ID,
          messages: [{ role: 'user', content: 'Hello' }],
          isCompacted: false,
          summary: null,
        },
      ];
      const msg: ConversationMessage = {
        role: 'assistant',
        content: 'Hi there!',
        timestamp: '2026-01-01T00:00:01Z',
      };
      const result = await memory.append(CHANNEL_ID, THREAD_ID, msg);
      expect(result.tokenCount).toBeGreaterThan(0);
      expect(mockUpdateCalled).toBe(true);
    });

    test('handles multiple messages in a single append', async () => {
      mockSelectRows = [];
      const msgs: ConversationMessage[] = [
        { role: 'user', content: 'What is 2+2?', timestamp: '2026-01-01T00:00:00Z' },
        { role: 'assistant', content: 'It is 4.', timestamp: '2026-01-01T00:00:01Z' },
      ];
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
