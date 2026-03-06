import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { LanguageModel } from 'ai';

const fakeModel = { modelId: 'test' } as unknown as LanguageModel;
const mockOpenai = mock(() => fakeModel);

const mockConfig: Record<string, string | undefined> = {
  OPENAI_API_KEY: 'sk-test-key',
};

mock.module('@ai-sdk/openai', () => ({
  openai: mockOpenai,
}));

mock.module('../../../config', () => ({
  config: mockConfig,
}));

import { openaiFactory } from '../openai';

describe('openaiFactory', () => {
  beforeEach(() => {
    mockConfig.OPENAI_API_KEY = 'sk-test-key';
    mockOpenai.mockClear();
  });

  test('name is "openai"', () => {
    expect(openaiFactory.name).toBe('openai');
  });

  test('defaultModel is gpt-4o', () => {
    expect(openaiFactory.defaultModel).toBe('gpt-4o');
  });

  test('isConfigured returns true when OPENAI_API_KEY is set', () => {
    expect(openaiFactory.isConfigured()).toBe(true);
  });

  test('isConfigured returns false when OPENAI_API_KEY is undefined', () => {
    mockConfig.OPENAI_API_KEY = undefined;
    expect(openaiFactory.isConfigured()).toBe(false);
  });

  test('isConfigured returns false when OPENAI_API_KEY is empty', () => {
    mockConfig.OPENAI_API_KEY = '';
    expect(openaiFactory.isConfigured()).toBe(false);
  });

  test('create returns a LanguageModel from the SDK', () => {
    const result = openaiFactory.create('gpt-4-turbo');
    expect(mockOpenai).toHaveBeenCalledWith('gpt-4-turbo');
    expect(result).toBe(fakeModel);
  });
});
