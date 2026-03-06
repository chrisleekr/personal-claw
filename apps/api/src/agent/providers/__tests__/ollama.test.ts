import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { LanguageModel } from 'ai';

const fakeModel = { modelId: 'test' } as unknown as LanguageModel;
const mockProviderFn = mock(() => fakeModel);

const mockConfig: Record<string, string | undefined> = {
  OLLAMA_BASE_URL: 'http://localhost:11434/api',
  OLLAMA_DEFAULT_MODEL: undefined,
};

mock.module('ollama-ai-provider-v2', () => ({
  createOllama: () => mockProviderFn,
}));

mock.module('../../../config', () => ({
  config: mockConfig,
}));

import { ollamaFactory } from '../ollama';

describe('ollamaFactory', () => {
  beforeEach(() => {
    mockConfig.OLLAMA_BASE_URL = 'http://localhost:11434/api';
    mockProviderFn.mockClear();
  });

  test('name is "ollama"', () => {
    expect(ollamaFactory.name).toBe('ollama');
  });

  test('defaultModel falls back to llama3.1 when OLLAMA_DEFAULT_MODEL is not set', () => {
    expect(ollamaFactory.defaultModel).toBe('llama3.1');
  });

  test('isConfigured returns true when OLLAMA_BASE_URL is set', () => {
    expect(ollamaFactory.isConfigured()).toBe(true);
  });

  test('isConfigured returns false when OLLAMA_BASE_URL is undefined', () => {
    mockConfig.OLLAMA_BASE_URL = undefined;
    expect(ollamaFactory.isConfigured()).toBe(false);
  });

  test('create returns a LanguageModel', () => {
    const result = ollamaFactory.create('mistral');
    expect(result).toBeDefined();
  });
});
