import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { LanguageModel } from 'ai';

const fakeModel = { modelId: 'test' } as unknown as LanguageModel;
const mockAnthropic = mock(() => fakeModel);

const mockConfig: Record<string, string | undefined> = {
  ANTHROPIC_API_KEY: 'sk-test-key',
};

mock.module('@ai-sdk/anthropic', () => ({
  anthropic: mockAnthropic,
}));

mock.module('../../../config', () => ({
  config: mockConfig,
}));

import { anthropicFactory } from '../anthropic';

describe('anthropicFactory', () => {
  beforeEach(() => {
    mockConfig.ANTHROPIC_API_KEY = 'sk-test-key';
    mockAnthropic.mockClear();
  });

  test('name is "anthropic"', () => {
    expect(anthropicFactory.name).toBe('anthropic');
  });

  test('defaultModel is claude-sonnet-4-20250514', () => {
    expect(anthropicFactory.defaultModel).toBe('claude-sonnet-4-20250514');
  });

  test('isConfigured returns true when ANTHROPIC_API_KEY is set', () => {
    expect(anthropicFactory.isConfigured()).toBe(true);
  });

  test('isConfigured returns false when ANTHROPIC_API_KEY is undefined', () => {
    mockConfig.ANTHROPIC_API_KEY = undefined;
    expect(anthropicFactory.isConfigured()).toBe(false);
  });

  test('isConfigured returns false when ANTHROPIC_API_KEY is empty', () => {
    mockConfig.ANTHROPIC_API_KEY = '';
    expect(anthropicFactory.isConfigured()).toBe(false);
  });

  test('isConfigured returns false for an sk-ant-oat* OAuth token', () => {
    // Claude Code CLI stores its OAuth token in ANTHROPIC_API_KEY with the
    // `sk-ant-oat01-...` prefix. That token authenticates the CLI and the
    // claude.ai web interface but is rejected by `@ai-sdk/anthropic` with
    // `"invalid x-api-key"`. Treating it as unconfigured lets callers fall
    // back to a working provider via the registry's `isConfigured()` check.
    mockConfig.ANTHROPIC_API_KEY = 'sk-ant-oat01-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    expect(anthropicFactory.isConfigured()).toBe(false);
  });

  test('isConfigured returns true for an sk-ant-api* real API key', () => {
    // Regression guard: the OAuth check is limited to the `sk-ant-oat`
    // prefix so real API keys (which begin with `sk-ant-api`) remain valid.
    mockConfig.ANTHROPIC_API_KEY = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    expect(anthropicFactory.isConfigured()).toBe(true);
  });

  test('create returns a LanguageModel from the SDK', () => {
    const result = anthropicFactory.create('claude-3-opus');
    expect(mockAnthropic).toHaveBeenCalledWith('claude-3-opus');
    expect(result).toBe(fakeModel);
  });
});
