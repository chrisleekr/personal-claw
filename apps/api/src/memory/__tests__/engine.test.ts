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
        _mockUpdateCalled = true;
        return chainable(() => []);
      },
    }),
    execute: async () => mockExecuteRows,
  }),
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
  });
});
