import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

let mockEmbeddingResult = [0.1, 0.2, 0.3];
let mockConfigValues: Record<string, string | undefined> = {};
let lastEmbedCall: { model: unknown; value: string; providerOptions: unknown } | null = null;
let lastOllamaBaseURL: string | null = null;
let embedThrowMessage: string | null = null;

mock.module('ai', () => ({
  embed: async (opts: { model: unknown; value: string; providerOptions?: unknown }) => {
    if (embedThrowMessage) {
      throw new Error(embedThrowMessage);
    }
    lastEmbedCall = {
      model: opts.model,
      value: opts.value,
      providerOptions: opts.providerOptions,
    };
    return { embedding: mockEmbeddingResult };
  },
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
    embedding: (model: string) => ({ provider: 'openai', model }),
  },
}));

mock.module('../../agent/provider', () => ({
  getBedrockProvider: () => ({
    embedding: (model: string) => ({ provider: 'bedrock', model }),
  }),
}));

mock.module('ollama-ai-provider-v2', () => ({
  createOllama: (opts: { baseURL: string }) => {
    lastOllamaBaseURL = opts.baseURL;
    return {
      embedding: (model: string) => ({ provider: 'ollama', model }),
    };
  },
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
    lastEmbedCall = null;
    lastOllamaBaseURL = null;
    embedThrowMessage = null;
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
    expect((lastEmbedCall?.model as { provider: string }).provider).toBe('bedrock');
  });

  test('defaults to openai provider', async () => {
    mockConfigValues = {};
    const result = await generateEmbedding('test text');
    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect((lastEmbedCall?.model as { provider: string }).provider).toBe('openai');
  });

  // T006: getEmbeddingProvider returns 'ollama' when configured
  test('uses ollama when configured', async () => {
    mockConfigValues = { EMBEDDING_PROVIDER: 'ollama' };
    await generateEmbedding('test text');
    expect((lastEmbedCall?.model as { provider: string }).provider).toBe('ollama');
    expect(lastEmbedCall?.providerOptions).toEqual({ ollama: { dimensions: 1024 } });
  });

  // T007: calls createOllama with correct base URL
  test('creates ollama provider with configured base URL', async () => {
    mockConfigValues = {
      EMBEDDING_PROVIDER: 'ollama',
      OLLAMA_BASE_URL: 'http://my-ollama:11434/api',
    };
    await generateEmbedding('test text');
    expect(lastOllamaBaseURL).toBe('http://my-ollama:11434/api');
  });

  test('creates ollama provider with default base URL when not configured', async () => {
    mockConfigValues = { EMBEDDING_PROVIDER: 'ollama' };
    await generateEmbedding('test text');
    expect(lastOllamaBaseURL).toBe('http://localhost:11434/api');
  });

  // T008: uses DEFAULT_OLLAMA_EMBEDDING_MODEL when no override
  test('uses mxbai-embed-large as default ollama model', async () => {
    mockConfigValues = { EMBEDDING_PROVIDER: 'ollama' };
    await generateEmbedding('test text');
    expect((lastEmbedCall?.model as { model: string }).model).toBe('mxbai-embed-large');
  });

  // T009: uses EMBEDDING_MODEL override for ollama
  test('uses EMBEDDING_MODEL override for ollama provider', async () => {
    mockConfigValues = {
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_MODEL: 'snowflake-arctic-embed',
    };
    await generateEmbedding('test text');
    expect((lastEmbedCall?.model as { model: string }).model).toBe('snowflake-arctic-embed');
  });

  // T010: falls back to openai when EMBEDDING_PROVIDER is unknown
  test('falls back to openai for unknown EMBEDDING_PROVIDER values', async () => {
    mockConfigValues = { EMBEDDING_PROVIDER: 'unknown-provider' };
    await generateEmbedding('test text');
    expect((lastEmbedCall?.model as { provider: string }).provider).toBe('openai');
  });

  test('falls back to openai when EMBEDDING_PROVIDER is unset', async () => {
    mockConfigValues = {};
    await generateEmbedding('test text');
    expect((lastEmbedCall?.model as { provider: string }).provider).toBe('openai');
  });

  // T012: ollama produces number[] output
  test('ollama provider returns number array', async () => {
    mockConfigValues = { EMBEDDING_PROVIDER: 'ollama' };
    mockEmbeddingResult = Array.from({ length: 1024 }, (_, i) => i / 1024);
    const result = await generateEmbedding('test');
    expect(Array.isArray(result)).toBe(true);
    expect(typeof result[0]).toBe('number');
    expect(result).toHaveLength(1024);
  });

  // T014: throws when ollama unreachable
  test('throws when embed() fails for ollama', async () => {
    embedThrowMessage = 'Connection refused';
    mockConfigValues = { EMBEDDING_PROVIDER: 'ollama' };
    await expect(generateEmbedding('test text')).rejects.toThrow('Connection refused');
  });

  // T015: throws when ollama model is not available
  test('throws when ollama model is not available', async () => {
    embedThrowMessage = 'model "foo" not found, try pulling it first';
    mockConfigValues = { EMBEDDING_PROVIDER: 'ollama' };
    await expect(generateEmbedding('test text')).rejects.toThrow('model');
  });
});
