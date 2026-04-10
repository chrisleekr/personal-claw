import { getLogger } from '@logtape/logtape';
import type { LanguageModel } from 'ai';
import { anthropicFactory } from './anthropic';
import { bedrockFactory } from './bedrock';
import { ollamaFactory } from './ollama';
import { openaiFactory } from './openai';
import type { ProviderFactory } from './types';

const logger = getLogger(['personalclaw', 'agent', 'provider-registry']);

export class ProviderRegistry {
  private factories = new Map<string, ProviderFactory>();

  register(factory: ProviderFactory): void {
    this.factories.set(factory.name, factory);
    logger.debug`Registered LLM provider: ${factory.name}`;
  }

  resolve(name: string, model?: string): { model: LanguageModel; modelId: string } {
    const factory = this.factories.get(name);
    if (!factory) {
      throw new Error(
        `Unknown LLM provider "${name}". Available: ${[...this.factories.keys()].join(', ')}`,
      );
    }
    const resolvedModel = model || factory.defaultModel;
    return { model: factory.create(resolvedModel), modelId: resolvedModel };
  }

  has(name: string): boolean {
    return this.factories.has(name);
  }

  /**
   * Returns `true` only when the named factory is both registered AND its
   * `isConfigured()` method returns `true`. Use this in preference to
   * `has()` at fallback decision points — a registered but unconfigured
   * factory (e.g., an OAuth token in `ANTHROPIC_API_KEY`) will otherwise
   * be picked up by `has()` and then error at request time.
   */
  isConfigured(name: string): boolean {
    return this.factories.get(name)?.isConfigured() ?? false;
  }

  list(): string[] {
    return [...this.factories.keys()];
  }

  listConfigured(): string[] {
    return [...this.factories.values()].filter((f) => f.isConfigured()).map((f) => f.name);
  }
}

let instance: ProviderRegistry | null = null;

export function getProviderRegistry(): ProviderRegistry {
  if (!instance) {
    instance = new ProviderRegistry();
    instance.register(anthropicFactory);
    instance.register(bedrockFactory);
    instance.register(openaiFactory);
    instance.register(ollamaFactory);

    logger.info('Provider registry initialized', {
      registered: instance.list(),
      configured: instance.listConfigured(),
    });
  }
  return instance;
}
