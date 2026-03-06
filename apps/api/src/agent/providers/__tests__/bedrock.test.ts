import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { LanguageModel } from 'ai';

const fakeModel = { modelId: 'test' } as unknown as LanguageModel;
const mockProvider = mock(() => fakeModel);

const mockConfig: Record<string, string | undefined> = {
  AWS_BEDROCK_REGION: 'us-east-1',
  AWS_BEDROCK_PROFILE: undefined,
  AWS_BEDROCK_ACCESS_KEY_ID: 'AKIA-test',
  AWS_BEDROCK_SECRET_ACCESS_KEY: 'secret-test',
  AWS_BEDROCK_MODEL: undefined,
};

mock.module('@ai-sdk/amazon-bedrock', () => ({
  createAmazonBedrock: () => mockProvider,
}));

mock.module('@aws-sdk/credential-providers', () => ({
  fromSSO: () => ({}),
}));

mock.module('../../../config', () => ({
  config: mockConfig,
}));

import { bedrockFactory } from '../bedrock';

describe('bedrockFactory', () => {
  beforeEach(() => {
    mockConfig.AWS_BEDROCK_REGION = 'us-east-1';
    mockConfig.AWS_BEDROCK_PROFILE = undefined;
    mockProvider.mockClear();
  });

  test('name is "bedrock"', () => {
    expect(bedrockFactory.name).toBe('bedrock');
  });

  test('defaultModel is a non-empty string', () => {
    expect(typeof bedrockFactory.defaultModel).toBe('string');
    expect(bedrockFactory.defaultModel.length).toBeGreaterThan(0);
  });

  test('isConfigured returns true when AWS_BEDROCK_REGION is set', () => {
    mockConfig.AWS_BEDROCK_REGION = 'us-west-2';
    mockConfig.AWS_BEDROCK_PROFILE = undefined;
    expect(bedrockFactory.isConfigured()).toBe(true);
  });

  test('isConfigured returns true when AWS_BEDROCK_PROFILE is set', () => {
    mockConfig.AWS_BEDROCK_REGION = undefined;
    mockConfig.AWS_BEDROCK_PROFILE = 'my-profile';
    expect(bedrockFactory.isConfigured()).toBe(true);
  });

  test('isConfigured returns false when neither region nor profile is set', () => {
    mockConfig.AWS_BEDROCK_REGION = undefined;
    mockConfig.AWS_BEDROCK_PROFILE = undefined;
    expect(bedrockFactory.isConfigured()).toBe(false);
  });

  test('create returns a LanguageModel from the bedrock provider', () => {
    const result = bedrockFactory.create('anthropic.claude-v2');
    expect(mockProvider).toHaveBeenCalledWith('anthropic.claude-v2');
    expect(result).toBe(fakeModel);
  });
});
