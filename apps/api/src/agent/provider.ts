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

  let providerName: string;
  let resolvedModel: string;

  try {
    const channel = await getCachedConfig(channelId);
    if (channel) {
      providerName = channel.provider || DEFAULT_PROVIDER;
      resolvedModel = channel.model || DEFAULT_MODEL;
    } else {
      providerName = config.LLM_PROVIDER || DEFAULT_PROVIDER;
      resolvedModel = DEFAULT_MODEL;
    }
  } catch (error) {
    logger.warn('Failed to load channel config, using defaults', {
      channelId,
      ...errorDetails(error),
    });
    providerName = config.LLM_PROVIDER || DEFAULT_PROVIDER;
    resolvedModel = DEFAULT_MODEL;
  }

  // If the requested provider is not configured (e.g., an OAuth token in
  // `ANTHROPIC_API_KEY` where `@ai-sdk/anthropic` expects a real API key),
  // fall back to Ollama so the main agent keeps working instead of
  // silently routing every request to a dead endpoint. Logged at WARN so
  // operators see the fallback in the usual log stream.
  if (!registry.isConfigured(providerName)) {
    logger.warn('Requested LLM provider is not configured, falling back to Ollama', {
      channelId,
      requested: providerName,
      requestedModel: resolvedModel,
    });
    const ollamaResolved = registry.resolve('ollama');
    return {
      provider: (m: string) => registry.resolve('ollama', m).model,
      model: ollamaResolved.modelId,
      providerName: 'ollama',
    };
  }

  return {
    provider: (m: string) => registry.resolve(providerName, m).model,
    model: resolvedModel,
    providerName,
  };
}

/**
 * Small-model preferences per provider for the injection detection
 * classifier layer (FR-002(e), research.md R1). Operators tune these at PR
 * time — channels inherit the classifier model from their active provider,
 * and the helper below selects the smallest / cheapest variant available.
 *
 * If a channel's active provider does not appear here, the helper falls
 * back to Ollama with `gemma4:latest` because that is the self-hosted
 * path verified in the PersonalClaw dev environment.
 */
const CLASSIFIER_MODEL_PER_PROVIDER: Record<string, string> = {
  ollama: 'gemma4:latest',
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
  bedrock: 'anthropic.claude-3-5-haiku-20241022-v1:0',
};

/**
 * Resolves a `LanguageModel` for the injection detection classifier layer
 * (FR-002(e)) per research.md R1. Uses the channel's configured provider
 * with a small-model override and falls back to Ollama `gemma4:latest`
 * when no mapping exists.
 *
 * @param channelId Channel whose configured provider determines routing
 * @returns Resolved provider info: `provider` factory, `model` id, `providerName`
 */
export async function getClassifierProvider(channelId: string): Promise<ResolvedProvider> {
  const registry = getProviderRegistry();
  try {
    const channel = await getCachedConfig(channelId);
    const providerName = channel?.provider || config.LLM_PROVIDER || DEFAULT_PROVIDER;
    const classifierModel =
      CLASSIFIER_MODEL_PER_PROVIDER[providerName] ?? CLASSIFIER_MODEL_PER_PROVIDER.ollama;
    // Require the factory be both registered AND actually configured. `has()`
    // returns `true` for a factory that's in the registry but whose
    // credentials are invalid (e.g., OAuth token in `ANTHROPIC_API_KEY`),
    // which previously routed every classifier call to a dead endpoint
    // and returned `error: unavailable` after ~350 ms. Switching to
    // `isConfigured()` makes the Ollama fallback path below actually
    // reachable for the common dev environment.
    if (registry.has(providerName) && registry.isConfigured(providerName)) {
      return {
        provider: (m: string) => registry.resolve(providerName, m).model,
        model: classifierModel,
        providerName,
      };
    }
    logger.warn('Classifier provider is not configured, falling back to Ollama gemma4', {
      channelId,
      requested: providerName,
    });
  } catch (error) {
    logger.warn('Failed to resolve classifier provider from channel config', {
      channelId,
      ...errorDetails(error),
    });
  }
  // Final fallback: Ollama gemma4. If Ollama is not registered, the
  // generateText call will throw and the classifier layer will convert
  // that into a deterministic fail-closed/fail-open result per FR-011.
  return {
    provider: (m: string) => registry.resolve('ollama', m).model,
    model: CLASSIFIER_MODEL_PER_PROVIDER.ollama,
    providerName: 'ollama',
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
