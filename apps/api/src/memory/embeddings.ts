import { openai } from '@ai-sdk/openai';
import { embed } from 'ai';
import { createOllama } from 'ollama-ai-provider-v2';
import { getBedrockProvider } from '../agent/provider';
import { config } from '../config';

type EmbeddingProvider = 'openai' | 'bedrock' | 'ollama';

const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
const DEFAULT_BEDROCK_EMBEDDING_MODEL = 'amazon.titan-embed-text-v2:0';
const DEFAULT_OLLAMA_EMBEDDING_MODEL = 'mxbai-embed-large';
const EMBEDDING_DIMENSIONS = 1024;

/**
 * Resolves the active embedding provider from configuration.
 * Defaults to `'openai'` when `EMBEDDING_PROVIDER` is unset or unrecognised.
 */
function getEmbeddingProvider(): EmbeddingProvider {
  if (config.EMBEDDING_PROVIDER === 'bedrock') return 'bedrock';
  if (config.EMBEDDING_PROVIDER === 'ollama') return 'ollama';
  return 'openai';
}

/**
 * Generates a 1024-dimension embedding vector for the given text
 * using the configured embedding provider (OpenAI, Bedrock, or Ollama).
 *
 * @param text - The text to embed.
 * @returns A 1024-dimension embedding vector.
 * @throws When the provider is unreachable or the model is unavailable.
 *   Callers (e.g. `LongTermMemory.save`) catch and degrade gracefully.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const provider = getEmbeddingProvider();
  const modelOverride = config.EMBEDDING_MODEL;

  if (provider === 'bedrock') {
    const bedrock = getBedrockProvider();
    const { embedding } = await embed({
      model: bedrock.embedding(modelOverride ?? DEFAULT_BEDROCK_EMBEDDING_MODEL),
      value: text,
      providerOptions: {
        bedrock: { dimensions: EMBEDDING_DIMENSIONS },
      },
    });
    return embedding;
  }

  if (provider === 'ollama') {
    const ollama = createOllama({
      baseURL: config.OLLAMA_BASE_URL ?? 'http://localhost:11434/api',
    });
    const { embedding } = await embed({
      model: ollama.embedding(modelOverride ?? DEFAULT_OLLAMA_EMBEDDING_MODEL),
      value: text,
      providerOptions: {
        ollama: { dimensions: EMBEDDING_DIMENSIONS },
      },
    });
    return embedding;
  }

  const { embedding } = await embed({
    model: openai.embedding(modelOverride ?? DEFAULT_OPENAI_EMBEDDING_MODEL),
    value: text,
    providerOptions: {
      openai: { dimensions: EMBEDDING_DIMENSIONS },
    },
  });
  return embedding;
}
