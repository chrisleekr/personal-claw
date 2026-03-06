import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { fromSSO } from '@aws-sdk/credential-providers';
import type { LanguageModel } from 'ai';
import { config } from '../../config';
import type { ProviderFactory } from './types';

type BedrockProvider = ReturnType<typeof createAmazonBedrock>;

let cached: BedrockProvider | null = null;

function getBedrockInstance(): BedrockProvider {
  if (cached) return cached;

  const region = config.AWS_BEDROCK_REGION || 'us-east-1';
  const profile = config.AWS_BEDROCK_PROFILE;

  if (profile) {
    cached = createAmazonBedrock({ region, credentialProvider: fromSSO({ profile }) });
  } else {
    cached = createAmazonBedrock({
      region,
      accessKeyId: config.AWS_BEDROCK_ACCESS_KEY_ID,
      secretAccessKey: config.AWS_BEDROCK_SECRET_ACCESS_KEY,
    });
  }

  return cached;
}

export function getBedrockProvider(): BedrockProvider {
  return getBedrockInstance();
}

export const bedrockFactory: ProviderFactory = {
  name: 'bedrock',
  defaultModel: config.AWS_BEDROCK_MODEL || 'us.anthropic.claude-sonnet-4-20250514-v1:0',

  create(model: string): LanguageModel {
    return getBedrockInstance()(model);
  },

  isConfigured(): boolean {
    return !!(config.AWS_BEDROCK_REGION || config.AWS_BEDROCK_PROFILE);
  },
};
