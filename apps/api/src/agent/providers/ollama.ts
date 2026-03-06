import type { LanguageModel } from 'ai';
import { createOllama } from 'ollama-ai-provider-v2';
import { config } from '../../config';
import type { ProviderFactory } from './types';

const ollamaProvider = createOllama({
  baseURL: config.OLLAMA_BASE_URL ?? 'http://localhost:11434/api',
});

export const ollamaFactory: ProviderFactory = {
  name: 'ollama',
  defaultModel: config.OLLAMA_DEFAULT_MODEL ?? 'llama3.1',

  create(model: string): LanguageModel {
    return ollamaProvider(model);
  },

  isConfigured(): boolean {
    return !!config.OLLAMA_BASE_URL;
  },
};
