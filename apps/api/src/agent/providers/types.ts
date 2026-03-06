import type { LanguageModel } from 'ai';

export interface ProviderFactory {
  readonly name: string;
  readonly defaultModel: string;
  create(model: string): LanguageModel;
  isConfigured(): boolean;
}
