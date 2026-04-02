import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),

  DATABASE_URL: z.string().min(1),
  VALKEY_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),

  AUTH_URL: z.string().default('http://localhost:3000'),
  API_SECRET:
    process.env.NODE_ENV === 'production'
      ? z.string().min(32, 'API_SECRET must be at least 32 characters in production')
      : z.string().optional(),

  // Slack platform (presence of SLACK_BOT_TOKEN enables Slack)
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_APP_TOKEN: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),
  SLACK_BOT_USER_ID: z.string().optional(),

  // LLM provider defaults
  LLM_PROVIDER: z.string().default('anthropic'),

  // Anthropic
  ANTHROPIC_API_KEY: z.string().optional(),

  // AWS Bedrock
  AWS_BEDROCK_REGION: z.string().optional(),
  AWS_BEDROCK_PROFILE: z.string().optional(),
  AWS_BEDROCK_ACCESS_KEY_ID: z.string().optional(),
  AWS_BEDROCK_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_BEDROCK_MODEL: z.string().optional(),

  // OpenAI
  OPENAI_API_KEY: z.string().optional(),

  // Ollama
  OLLAMA_BASE_URL: z.string().optional(),
  OLLAMA_DEFAULT_MODEL: z.string().optional(),

  // Embeddings
  EMBEDDING_PROVIDER: z.string().optional(),
  EMBEDDING_MODEL: z.string().optional(),

  // Audit transcripts
  TRANSCRIPT_DIR: z.string().default('data/transcripts'),
});

export type AppConfig = z.infer<typeof envSchema>;

export const config: AppConfig = envSchema.parse(process.env);

export function redisUrl(): string {
  return config.VALKEY_URL ?? config.REDIS_URL ?? 'redis://localhost:6379';
}
