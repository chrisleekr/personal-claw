import { anthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import { config } from '../../config';
import type { ProviderFactory } from './types';

export const anthropicFactory: ProviderFactory = {
  name: 'anthropic',
  defaultModel: 'claude-sonnet-4-20250514',

  create(model: string): LanguageModel {
    return anthropic(model);
  },

  isConfigured(): boolean {
    return !!config.ANTHROPIC_API_KEY;
  },
};
