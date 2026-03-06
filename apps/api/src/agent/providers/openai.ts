import { openai } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { config } from '../../config';
import type { ProviderFactory } from './types';

export const openaiFactory: ProviderFactory = {
  name: 'openai',
  defaultModel: 'gpt-4o',

  create(model: string): LanguageModel {
    return openai(model);
  },

  isConfigured(): boolean {
    return !!config.OPENAI_API_KEY;
  },
};
