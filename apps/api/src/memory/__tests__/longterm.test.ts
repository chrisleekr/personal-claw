import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';

const MOCK_MEMORY = {
  id: 'mem-001',
  channelId: CHANNEL_ID,
  content: 'User prefers dark mode',
  category: 'preference',
  sourceThreadId: null,
  recallCount: 3,
  lastRecalledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

let mockSelectRows: unknown[] = [];
let mockInsertCalled = false;
let mockUpdateCalled = false;
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
        mockUpdateCalled = true;
        return chainable(() => []);
      },
    }),
    execute: async () => mockExecuteRows,
  }),
}));

mock.module('../embeddings', () => ({
  generateEmbedding: async () => Array.from({ length: 1024 }, () => Math.random()),
}));

import { LongTermMemory } from '../longterm';

describe('LongTermMemory', () => {
  let memory: LongTermMemory;

  beforeEach(() => {
    memory = new LongTermMemory();
    mockSelectRows = [];
    mockInsertCalled = false;
    mockUpdateCalled = false;
    mockExecuteRows = [];
  });

  afterEach(() => {
    mockSelectRows = [];
    mockInsertCalled = false;
    mockUpdateCalled = false;
    mockExecuteRows = [];
  });

  describe('save', () => {
    test('saves memory with embedding', async () => {
      await memory.save(CHANNEL_ID, 'User likes TypeScript', 'preference');
      expect(mockInsertCalled).toBe(true);
    });

    test('saves memory with source thread id', async () => {
      await memory.save(CHANNEL_ID, 'Important fact', 'fact', 'thread-123');
      expect(mockInsertCalled).toBe(true);
    });
  });

  describe('search', () => {
    test('returns merged results from vector and keyword search', async () => {
      mockExecuteRows = [MOCK_MEMORY];
      const results = await memory.search(CHANNEL_ID, 'dark mode');
      expect(results.length).toBeGreaterThan(0);
    });

    test('deduplicates results across vector and keyword', async () => {
      mockExecuteRows = [MOCK_MEMORY, MOCK_MEMORY];
      const results = await memory.search(CHANNEL_ID, 'dark mode');
      expect(results).toHaveLength(1);
    });

    test('respects limit parameter', async () => {
      mockExecuteRows = Array.from({ length: 20 }, (_, i) => ({
        ...MOCK_MEMORY,
        id: `mem-${i}`,
      }));
      const results = await memory.search(CHANNEL_ID, 'test', 5);
      expect(results.length).toBeLessThanOrEqual(5);
    });

    test('returns empty array for no results', async () => {
      mockExecuteRows = [];
      const results = await memory.search(CHANNEL_ID, 'nonexistent');
      expect(results).toEqual([]);
    });
  });

  describe('list', () => {
    test('returns memories for channel', async () => {
      mockSelectRows = [MOCK_MEMORY];
      const results = await memory.list(CHANNEL_ID);
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('User prefers dark mode');
      expect(results[0].category).toBe('preference');
    });

    test('returns empty array for no memories', async () => {
      mockSelectRows = [];
      const results = await memory.list(CHANNEL_ID);
      expect(results).toHaveLength(0);
    });

    test('normalizes invalid category to "fact"', async () => {
      mockSelectRows = [{ ...MOCK_MEMORY, category: 'invalid_category' }];
      const results = await memory.list(CHANNEL_ID);
      expect(results[0].category).toBe('fact');
    });
  });

  describe('incrementRecall', () => {
    test('updates recall count for given memory ids', async () => {
      await memory.incrementRecall(['mem-001', 'mem-002']);
      expect(mockUpdateCalled).toBe(true);
    });

    test('does nothing for empty array', async () => {
      await memory.incrementRecall([]);
      expect(mockUpdateCalled).toBe(false);
    });
  });
});
