import { describe, expect, mock, test } from 'bun:test';
import type { LanguageModel } from 'ai';
import type { ProviderFactory } from '../types';

mock.module('../anthropic', () => ({
  anthropicFactory: {
    name: 'anthropic',
    defaultModel: 'claude-sonnet-4-20250514',
    create: (model: string) => ({ model }) as unknown as LanguageModel,
    isConfigured: () => true,
  } satisfies ProviderFactory,
}));

mock.module('../bedrock', () => ({
  bedrockFactory: {
    name: 'bedrock',
    defaultModel: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
    create: (model: string) => ({ model }) as unknown as LanguageModel,
    isConfigured: () => false,
  } satisfies ProviderFactory,
}));

mock.module('../openai', () => ({
  openaiFactory: {
    name: 'openai',
    defaultModel: 'gpt-4o',
    create: (model: string) => ({ model }) as unknown as LanguageModel,
    isConfigured: () => false,
  } satisfies ProviderFactory,
}));

mock.module('../ollama', () => ({
  ollamaFactory: {
    name: 'ollama',
    defaultModel: 'llama3.1:8b',
    create: (model: string) => ({ model }) as unknown as LanguageModel,
    isConfigured: () => false,
  } satisfies ProviderFactory,
}));

import { getProviderRegistry, ProviderRegistry } from '../registry';

describe('ProviderRegistry', () => {
  test('register adds a factory', () => {
    const registry = new ProviderRegistry();
    const factory: ProviderFactory = {
      name: 'test-provider',
      defaultModel: 'test-model',
      create: (m) => ({ model: m }) as unknown as LanguageModel,
      isConfigured: () => true,
    };
    registry.register(factory);
    expect(registry.has('test-provider')).toBe(true);
  });

  test('resolve returns model instance and modelId', () => {
    const registry = new ProviderRegistry();
    const factory: ProviderFactory = {
      name: 'test',
      defaultModel: 'default-model',
      create: (m) => ({ modelId: m }) as unknown as LanguageModel,
      isConfigured: () => true,
    };
    registry.register(factory);
    const result = registry.resolve('test', 'custom-model');
    expect(result.modelId).toBe('custom-model');
  });

  test('resolve uses defaultModel when model not specified', () => {
    const registry = new ProviderRegistry();
    const factory: ProviderFactory = {
      name: 'test',
      defaultModel: 'default-model',
      create: (m) => ({ modelId: m }) as unknown as LanguageModel,
      isConfigured: () => true,
    };
    registry.register(factory);
    const result = registry.resolve('test');
    expect(result.modelId).toBe('default-model');
  });

  test('resolve throws for unknown provider', () => {
    const registry = new ProviderRegistry();
    expect(() => registry.resolve('nonexistent')).toThrow('Unknown LLM provider');
  });

  test('has returns false for unregistered provider', () => {
    const registry = new ProviderRegistry();
    expect(registry.has('missing')).toBe(false);
  });

  test('list returns all registered provider names', () => {
    const registry = new ProviderRegistry();
    registry.register({
      name: 'a',
      defaultModel: 'm',
      create: () => ({}) as LanguageModel,
      isConfigured: () => true,
    });
    registry.register({
      name: 'b',
      defaultModel: 'm',
      create: () => ({}) as LanguageModel,
      isConfigured: () => false,
    });
    expect(registry.list()).toEqual(['a', 'b']);
  });

  test('listConfigured returns only providers with isConfigured() true', () => {
    const registry = new ProviderRegistry();
    registry.register({
      name: 'configured',
      defaultModel: 'm',
      create: () => ({}) as LanguageModel,
      isConfigured: () => true,
    });
    registry.register({
      name: 'unconfigured',
      defaultModel: 'm',
      create: () => ({}) as LanguageModel,
      isConfigured: () => false,
    });
    expect(registry.listConfigured()).toEqual(['configured']);
  });
});

describe('getProviderRegistry', () => {
  test('returns a registry with has method', () => {
    const registry = getProviderRegistry();
    expect(typeof registry.has).toBe('function');
    expect(registry.has('anthropic')).toBe(true);
    expect(registry.has('bedrock')).toBe(true);
    expect(registry.has('openai')).toBe(true);
    expect(registry.has('ollama')).toBe(true);
  });
});
