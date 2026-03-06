import { getLogger } from '@logtape/logtape';
import type { LLMProvider, ProviderFallbackEntry } from '@personalclaw/shared';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, providerFallbackEntrySchema } from '@personalclaw/shared';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import { getCachedConfig } from '../channels/config-cache';
import { config } from '../config';
import { errorDetails } from '../utils/error-fmt';
import { getProviderRegistry } from './providers/registry';

const logger = getLogger(['personalclaw', 'agent', 'provider']);

export { getBedrockProvider } from './providers/bedrock';

export interface ResolvedProvider {
  provider: (model: string) => LanguageModel;
  model: string;
  providerName: string;
}

export function resolveProviderEntry(
  providerName: LLMProvider,
  model?: string,
): { provider: (model: string) => LanguageModel; model: string } {
  const registry = getProviderRegistry();
  const factory = registry.has(providerName) ? providerName : DEFAULT_PROVIDER;
  const resolved = registry.resolve(factory, model);
  return {
    provider: (m: string) => registry.resolve(factory, m).model,
    model: resolved.modelId,
  };
}

export async function getProvider(channelId: string): Promise<ResolvedProvider> {
  const registry = getProviderRegistry();

  try {
    const channel = await getCachedConfig(channelId);

    if (channel) {
      const providerName = channel.provider || DEFAULT_PROVIDER;
      const resolvedModel = channel.model || DEFAULT_MODEL;
      return {
        provider: (m: string) => registry.resolve(providerName, m).model,
        model: resolvedModel,
        providerName,
      };
    }
  } catch (error) {
    logger.warn('Failed to load channel config, using defaults', {
      channelId,
      ...errorDetails(error),
    });
  }

  const providerName = config.LLM_PROVIDER || DEFAULT_PROVIDER;
  return {
    provider: (m: string) => registry.resolve(providerName, m).model,
    model: DEFAULT_MODEL,
    providerName,
  };
}

export async function getProviderWithFallback(channelId: string): Promise<
  ResolvedProvider & {
    fallbackChain: ProviderFallbackEntry[];
  }
> {
  let fallbackChain: ProviderFallbackEntry[] = [];

  try {
    const channel = await getCachedConfig(channelId);

    if (channel?.providerFallback) {
      const parsed = z.array(providerFallbackEntrySchema).safeParse(channel.providerFallback);
      if (parsed.success) {
        fallbackChain = parsed.data;
      } else {
        logger.warn('Invalid providerFallback config, using empty chain', {
          channelId,
          errors: parsed.error.issues,
        });
      }
    }
  } catch (error) {
    logger.warn('Failed to load fallback chain', { channelId, ...errorDetails(error) });
  }

  const primary = await getProvider(channelId);
  return { ...primary, fallbackChain };
}
