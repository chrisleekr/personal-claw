import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

let mockEmbeddingResult = [0.1, 0.2, 0.3];
let mockConfigValues: Record<string, string | undefined> = {};

mock.module('ai', () => ({
  embed: async () => ({ embedding: mockEmbeddingResult }),
  embedMany: async () => ({ embeddings: [mockEmbeddingResult] }),
  generateText: async () => ({ text: '' }),
  tool: (def: { description?: string; inputSchema?: unknown; execute?: unknown }) => ({
    type: 'tool' as const,
    parameters: def.inputSchema,
    execute: def.execute,
    description: def.description,
  }),
  stepCountIs: () => () => false,
}));

mock.module('@ai-sdk/openai', () => ({
  openai: {
    embedding: (model: string) => ({ model }),
  },
}));

mock.module('../../agent/provider', () => ({
  getBedrockProvider: () => ({
    embedding: (model: string) => ({ model }),
  }),
}));

mock.module('../../config', () => ({
  config: new Proxy(
    {},
    {
      get(_target, prop) {
        return mockConfigValues[prop as string];
      },
    },
  ),
}));

import { generateEmbedding } from '../embeddings';

describe('generateEmbedding', () => {
  beforeEach(() => {
    mockEmbeddingResult = [0.1, 0.2, 0.3];
    mockConfigValues = {};
  });

  afterEach(() => {
    mockConfigValues = {};
  });

  test('returns embedding vector', async () => {
    const result = await generateEmbedding('Hello world');
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });

  test('returns correct dimensionality', async () => {
    mockEmbeddingResult = Array.from({ length: 1024 }, (_, i) => i / 1024);
    const result = await generateEmbedding('test');
    expect(result).toHaveLength(1024);
  });

  test('uses bedrock when configured', async () => {
    mockConfigValues = { EMBEDDING_PROVIDER: 'bedrock' };
    const result = await generateEmbedding('test text');
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });

  test('defaults to openai provider', async () => {
    mockConfigValues = {};
    const result = await generateEmbedding('test text');
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });
});
