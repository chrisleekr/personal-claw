import { openai } from '@ai-sdk/openai';
import { embed } from 'ai';
import { getBedrockProvider } from '../agent/provider';
import { config } from '../config';

type EmbeddingProvider = 'openai' | 'bedrock';

const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
const DEFAULT_BEDROCK_EMBEDDING_MODEL = 'amazon.titan-embed-text-v2:0';
const EMBEDDING_DIMENSIONS = 1024;

function getEmbeddingProvider(): EmbeddingProvider {
  if (config.EMBEDDING_PROVIDER === 'bedrock') return 'bedrock';
  return 'openai';
}

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

  const { embedding } = await embed({
    model: openai.embedding(modelOverride ?? DEFAULT_OPENAI_EMBEDDING_MODEL),
    value: text,
    providerOptions: {
      openai: { dimensions: EMBEDDING_DIMENSIONS },
    },
  });
  return embedding;
}
