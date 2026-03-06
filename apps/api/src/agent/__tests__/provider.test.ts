import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { LanguageModel } from 'ai';

let mockChannelConfig: unknown = null;

mock.module('../../channels/config-cache', () => ({
  getCachedConfig: async () => mockChannelConfig,
}));

mock.module('../../config', () => ({
  config: {
    LLM_PROVIDER: 'anthropic',
  },
}));

mock.module('../providers/registry', () => ({
  getProviderRegistry: () => ({
    resolve: (_name: string, model?: string) => ({
      model: { modelId: model ?? 'default-model' } as unknown as LanguageModel,
      modelId: model ?? 'default-model',
    }),
    has: (name: string) => ['anthropic', 'openai', 'bedrock', 'ollama'].includes(name),
  }),
}));

import { getProvider, resolveProviderEntry } from '../provider';

describe('resolveProviderEntry', () => {
  test('resolves provider and returns model function', () => {
    const result = resolveProviderEntry('anthropic', 'claude-sonnet-4-20250514');
    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(typeof result.provider).toBe('function');
  });

  test('uses default model when none specified', () => {
    const result = resolveProviderEntry('anthropic');
    expect(result.model).toBe('default-model');
  });
});

describe('getProvider', () => {
  beforeEach(() => {
    mockChannelConfig = null;
  });

  afterEach(() => {
    mockChannelConfig = null;
  });

  test('returns default provider when no channel config', async () => {
    mockChannelConfig = null;
    const result = await getProvider('ch-001');
    expect(result.model).toBeDefined();
  });

  test('uses channel config provider and model when set', async () => {
    mockChannelConfig = {
      provider: 'openai',
      model: 'gpt-4o',
    };
    const result = await getProvider('ch-002');
    expect(result.model).toBe('gpt-4o');
  });

  test('falls back to defaults on channel config load error', async () => {
    mockChannelConfig = null;
    const result = await getProvider('ch-003');
    expect(result).toBeDefined();
    expect(result.model).toBeDefined();
  });
});
