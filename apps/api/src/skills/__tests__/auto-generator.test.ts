import { beforeEach, describe, expect, mock, test } from 'bun:test';

let mockSelectRows: unknown[] = [];
let mockInsertCalled = false;
let _mockInsertValues: unknown = null;
let mockUpdateCalled = false;

function chainable(getRows: () => unknown[]): unknown {
  const methods: Record<string, unknown> = {};
  for (const name of ['from', 'where', 'orderBy', 'limit', 'groupBy', 'returning', 'set']) {
    methods[name] = () => chainable(getRows);
  }
  methods.onConflictDoUpdate = () => chainable(getRows);
  return Object.assign([...getRows()], methods);
}

mock.module('../../db', () => ({
  getDb: () => ({
    select: () => chainable(() => mockSelectRows),
    insert: () => ({
      values: (v: unknown) => {
        mockInsertCalled = true;
        _mockInsertValues = v;
        return chainable(() => [{ id: 'new-skill-id' }]);
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

mock.module('../../agent/provider', () => ({
  getProvider: async () => ({
    provider: () => 'mock-model',
    model: 'test-model',
  }),
}));

mock.module('ai', () => ({
  generateText: async () => ({ text: 'Generated skill content here.' }),
  tool: (def: { description?: string; inputSchema?: unknown; execute?: unknown }) => ({
    type: 'tool' as const,
    parameters: def.inputSchema,
    execute: def.execute,
    description: def.description,
  }),
  stepCountIs: (_n: number) => () => false,
  embed: async () => ({ embedding: [] }),
  embedMany: async () => ({ embeddings: [] }),
}));

import { SkillAutoGenerator } from '../auto-generator';

describe('SkillAutoGenerator', () => {
  beforeEach(() => {
    mockSelectRows = [];
    mockInsertCalled = false;
    _mockInsertValues = null;
    mockUpdateCalled = false;
  });

  test('trackPattern does nothing for sequences shorter than 2', async () => {
    const gen = new SkillAutoGenerator();
    await gen.trackPattern('ch-1', ['only_one'], true);
    expect(mockInsertCalled).toBe(false);
  });

  test('trackPattern inserts a pattern for sequences of 2+', async () => {
    const gen = new SkillAutoGenerator();
    await gen.trackPattern('ch-1', ['tool_a', 'tool_b'], true);
    expect(mockInsertCalled).toBe(true);
  });

  test('checkForGeneration finds eligible patterns and generates skills', async () => {
    mockSelectRows = [
      {
        id: 'pattern-1',
        channelId: 'ch-1',
        toolSequence: ['memory_search', 'cli_execute'],
        occurrenceCount: 10,
        successCount: 9,
        generatedSkillId: null,
        description: null,
      },
    ];
    const gen = new SkillAutoGenerator();
    await gen.checkForGeneration('ch-1');
    expect(mockInsertCalled).toBe(true);
    expect(mockUpdateCalled).toBe(true);
  });

  test('checkForGeneration skips patterns below occurrence threshold', async () => {
    mockSelectRows = [
      {
        id: 'pattern-2',
        channelId: 'ch-1',
        toolSequence: ['tool_a', 'tool_b'],
        occurrenceCount: 1,
        successCount: 1,
        generatedSkillId: null,
        description: null,
      },
    ];
    const gen = new SkillAutoGenerator();
    await gen.checkForGeneration('ch-1');
    expect(mockInsertCalled).toBe(false);
  });

  test('checkForGeneration skips patterns with existing generated skill', async () => {
    mockSelectRows = [
      {
        id: 'pattern-3',
        channelId: 'ch-1',
        toolSequence: ['tool_a', 'tool_b'],
        occurrenceCount: 100,
        successCount: 95,
        generatedSkillId: 'already-exists',
        description: null,
      },
    ];
    const gen = new SkillAutoGenerator();
    await gen.checkForGeneration('ch-1');
    expect(mockInsertCalled).toBe(false);
  });
});
