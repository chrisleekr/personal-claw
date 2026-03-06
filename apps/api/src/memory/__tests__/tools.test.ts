import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

let mockInsertCalled = false;
let mockSelectRows: unknown[] = [];
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
      set: () => chainable(() => []),
    }),
    execute: async () => mockExecuteRows,
  }),
}));

mock.module('../embeddings', () => ({
  generateEmbedding: async () => Array.from({ length: 1024 }, () => 0.1),
}));

mock.module('../../hooks/engine', () => ({
  HooksEngine: {
    getInstance: () => ({
      emit: async () => {},
    }),
  },
}));

import { getMemoryTools } from '../tools';

describe('getMemoryTools', () => {
  const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';

  beforeEach(() => {
    mockInsertCalled = false;
    mockSelectRows = [];
    mockExecuteRows = [];
  });

  afterEach(() => {
    mockInsertCalled = false;
    mockSelectRows = [];
    mockExecuteRows = [];
  });

  test('returns memory_save, memory_search, and memory_list tools', () => {
    const tools = getMemoryTools(CHANNEL_ID);
    expect(tools.memory_save).toBeDefined();
    expect(tools.memory_search).toBeDefined();
    expect(tools.memory_list).toBeDefined();
  });

  test('memory_save executes and returns saved confirmation', async () => {
    const tools = getMemoryTools(CHANNEL_ID, 'user-1', 'thread-1');
    const result = await tools.memory_save.execute(
      { content: 'User likes dark mode', category: 'preference' },
      { toolCallId: 'tc-1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(result.saved).toBe(true);
    expect(result.content).toBe('User likes dark mode');
    expect(result.category).toBe('preference');
    expect(mockInsertCalled).toBe(true);
  });

  test('memory_search executes and returns results', async () => {
    mockExecuteRows = [
      {
        id: 'mem-1',
        channel_id: CHANNEL_ID,
        content: 'User prefers dark mode',
        category: 'preference',
        recall_count: 3,
        last_recalled_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];
    const tools = getMemoryTools(CHANNEL_ID);
    const result = await tools.memory_search.execute(
      { query: 'dark mode', limit: 10 },
      { toolCallId: 'tc-2', messages: [], abortSignal: new AbortController().signal },
    );
    expect(result.results).toBeArray();
  });

  test('memory_list executes and returns memories', async () => {
    mockSelectRows = [
      {
        id: 'mem-1',
        channelId: CHANNEL_ID,
        content: 'A fact',
        category: 'fact',
        recallCount: 1,
        lastRecalledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    const tools = getMemoryTools(CHANNEL_ID);
    const result = await tools.memory_list.execute(
      {},
      { toolCallId: 'tc-3', messages: [], abortSignal: new AbortController().signal },
    );
    expect(result.memories).toBeArray();
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0].content).toBe('A fact');
  });
});
