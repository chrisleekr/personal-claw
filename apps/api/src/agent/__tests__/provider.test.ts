import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { LanguageModel } from 'ai';

let mockChannelConfig: unknown = null;

// Per-test control over which providers are reported as configured. Default
// allows all four so the legacy tests pass unchanged; individual tests flip
// specific entries to `false` to exercise the new OAuth/unconfigured fallback
// path that lands in this change.
const mockConfiguredProviders: Record<string, boolean> = {
  anthropic: true,
  openai: true,
  bedrock: true,
  ollama: true,
};

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
    resolve: (name: string, model?: string) => ({
      // Encode the provider name in the returned modelId so tests can assert
      // which provider the fallback actually routed to.
      model: { modelId: model ?? `${name}-default` } as unknown as LanguageModel,
      modelId: model ?? `${name}-default`,
    }),
    has: (name: string) => ['anthropic', 'openai', 'bedrock', 'ollama'].includes(name),
    isConfigured: (name: string) => mockConfiguredProviders[name] ?? false,
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
    // The mocked registry encodes the provider name in the default modelId
    // (`${name}-default`) so new fallback tests can assert that an
    // unconfigured provider routed to Ollama instead of the requested one.
    expect(result.model).toBe('anthropic-default');
  });
});

describe('getProvider', () => {
  beforeEach(() => {
    mockChannelConfig = null;
    mockConfiguredProviders.anthropic = true;
    mockConfiguredProviders.openai = true;
    mockConfiguredProviders.bedrock = true;
    mockConfiguredProviders.ollama = true;
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

  test('falls back to Ollama when requested provider is not configured', async () => {
    // Simulates the real-world scenario where `ANTHROPIC_API_KEY` holds an
    // OAuth token (`sk-ant-oat*`) that the SDK rejects, so the Anthropic
    // factory's `isConfigured()` returns false. The main agent must not
    // silently route to a dead endpoint.
    mockChannelConfig = null;
    mockConfiguredProviders.anthropic = false;
    const result = await getProvider('ch-004');
    expect(result.providerName).toBe('ollama');
    expect(result.model).toBe('ollama-default');
  });

  test('falls back to Ollama when channel explicitly picks an unconfigured provider', async () => {
    // Channel config can still point at `anthropic`, but if the provider is
    // not configured the fallback kicks in regardless of the channel
    // setting. Operators see the requested provider in the WARN log.
    mockChannelConfig = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
    };
    mockConfiguredProviders.anthropic = false;
    const result = await getProvider('ch-005');
    expect(result.providerName).toBe('ollama');
  });
});
