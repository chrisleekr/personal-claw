export const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
export const DEFAULT_BEDROCK_MODEL = 'us.anthropic.claude-sonnet-4-20250514-v1:0';
export const DEFAULT_PROVIDER = 'anthropic' as const;
export const DEFAULT_MAX_ITERATIONS = 10;
export const DEFAULT_HEARTBEAT_CRON = '*/30 * * * *';
export const DEFAULT_MEMORY_CONFIG = {
  maxMemories: 200,
  injectTopN: 10,
} as const;
export const DEFAULT_PROMPT_INJECT_MODE = 'every-turn' as const;

export const VALKEY_KEYS = {
  threadState: (channelId: string, threadId: string) => `thread:${channelId}:${threadId}`,
  channelConfig: (channelId: string) => `config:${channelId}`,
  channelResolver: (platform: string, externalId: string) => `ch:${platform}:${externalId}`,
  subtaskResult: (taskId: string) => `subtask:${taskId}`,
  rateLimitUser: (channelId: string, userId: string) => `ratelimit:${channelId}:${userId}`,
  budgetAlert: (channelId: string, date: string, level: string) =>
    `budget-alert:${channelId}:${date}:${level}`,
  feedbackMeta: (channelId: string, threadId: string) => `feedback:${channelId}:${threadId}`,
} as const;

export const VALKEY_TTL = {
  threadState: 86400,
  channelConfig: 300,
  channelResolver: 300,
  subtaskResult: 3600,
  rateLimitWindow: 60,
  feedbackMeta: 86400,
} as const;

export const COMPACTION_TOKEN_THRESHOLD = 80000;
export const BUDGET_ALERT_WARNING_THRESHOLD = 0.8;
export const BUDGET_ALERT_EXCEEDED_THRESHOLD = 1.0;
export const MEMORY_DECAY_DAYS = 90;
export const SKILL_AUTO_GEN_MIN_OCCURRENCES = 5;
export const SKILL_AUTO_GEN_MIN_SUCCESS_RATE = 0.7;

export const SLASH_COMMANDS = [
  'help',
  'status',
  'model',
  'skills',
  'memory',
  'compact',
  'config',
  'admin',
] as const;

/** Commands any channel member can execute. */
export const READ_ONLY_COMMANDS: ReadonlySet<string> = new Set([
  'help',
  'status',
  'skills',
  'memory',
  'config',
]);

/** Commands restricted to channel admins. */
export const ADMIN_COMMANDS: ReadonlySet<string> = new Set(['model', 'compact']);

export const MODEL_PRICING: Record<
  string,
  { promptPerMillion: number; completionPerMillion: number }
> = {
  // Anthropic (direct API)
  'claude-sonnet-4-20250514': { promptPerMillion: 3, completionPerMillion: 15 },
  'claude-opus-4-20250514': { promptPerMillion: 15, completionPerMillion: 75 },
  'claude-haiku-3-5-20241022': { promptPerMillion: 0.8, completionPerMillion: 4 },
  // Anthropic (Bedrock)
  'us.anthropic.claude-sonnet-4-20250514-v1:0': { promptPerMillion: 3, completionPerMillion: 15 },
  'us.anthropic.claude-opus-4-20250514-v1:0': { promptPerMillion: 15, completionPerMillion: 75 },
  'us.anthropic.claude-opus-4-6-v1': { promptPerMillion: 15, completionPerMillion: 75 },
  'us.anthropic.claude-haiku-3-5-20241022-v1:0': { promptPerMillion: 0.8, completionPerMillion: 4 },
  // OpenAI
  'gpt-4o': { promptPerMillion: 2.5, completionPerMillion: 10 },
  'gpt-4o-mini': { promptPerMillion: 0.15, completionPerMillion: 0.6 },
  'gpt-4.1': { promptPerMillion: 2, completionPerMillion: 8 },
  'gpt-4.1-mini': { promptPerMillion: 0.4, completionPerMillion: 1.6 },
  'gpt-4.1-nano': { promptPerMillion: 0.1, completionPerMillion: 0.4 },
  'o3-mini': { promptPerMillion: 1.1, completionPerMillion: 4.4 },
};
