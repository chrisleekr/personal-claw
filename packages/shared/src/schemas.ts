import { z } from 'zod';
import {
  DEFAULT_HEARTBEAT_CRON,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_MODEL,
  DEFAULT_PROMPT_INJECT_MODE,
  DEFAULT_PROVIDER,
} from './constants';

export const memoryConfigSchema = z.object({
  maxMemories: z.number().int().positive().default(200),
  injectTopN: z.number().int().positive().default(10),
  embeddingModel: z.string().optional(),
});

export const llmProviderSchema = z.string().min(1);

export const providerFallbackEntrySchema = z.object({
  provider: llmProviderSchema,
  model: z.string(),
});

export const guardrailsConfigSchema = z.object({
  preProcessing: z.object({
    contentFiltering: z.boolean().default(true),
    intentClassification: z.boolean().default(false),
    maxInputLength: z.number().int().positive().default(10000),
  }),
  postProcessing: z.object({
    piiRedaction: z.boolean().default(false),
    outputValidation: z.boolean().default(true),
  }),
});

export const sandboxConfigSchema = z.object({
  allowedCommands: z
    .array(z.string().min(1))
    .default([
      'bash',
      'sh',
      'git',
      'node',
      'bun',
      'python3',
      'pip',
      'aws',
      'gh',
      'curl',
      'jq',
      'cat',
      'ls',
      'grep',
      'find',
      'head',
      'tail',
      'wc',
      'mkdir',
      'cp',
      'mv',
      'touch',
      'echo',
    ]),
  deniedPatterns: z.array(z.string()).default(['rm -rf /', 'mkfs', 'dd if=']),
  maxExecutionTimeS: z.number().int().min(1).max(300).default(60),
  maxWorkspaceSizeMb: z.number().int().min(1).max(2048).default(256),
  networkAccess: z.boolean().default(true),
  gitTokenEnvVar: z.string().nullable().default(null),
});

export const channelPlatformSchema = z.enum(['slack', 'discord', 'teams', 'cli']);

export const threadReplyModeSchema = z.enum(['all', 'mentions_only', 'original_poster']);

export const autonomyLevelSchema = z.enum(['cautious', 'balanced', 'autonomous']);

export const createChannelSchema = z.object({
  platform: channelPlatformSchema.default('slack'),
  externalId: z.string().min(1),
  externalName: z.string().optional(),
  identityPrompt: z.string().optional(),
  teamPrompt: z.string().optional(),
  model: z.string().default(DEFAULT_MODEL),
  provider: llmProviderSchema.default(DEFAULT_PROVIDER),
  maxIterations: z.number().int().min(1).max(50).default(DEFAULT_MAX_ITERATIONS),
  heartbeatEnabled: z.boolean().default(false),
  heartbeatPrompt: z.string().nullable().optional(),
  heartbeatCron: z.string().default(DEFAULT_HEARTBEAT_CRON),
  promptInjectMode: z.enum(['every-turn', 'once', 'minimal']).default(DEFAULT_PROMPT_INJECT_MODE),
  threadReplyMode: threadReplyModeSchema.default('all'),
  autonomyLevel: autonomyLevelSchema.default('balanced'),
  sandboxEnabled: z.boolean().default(true),
  sandboxConfig: sandboxConfigSchema.nullable().optional(),
  guardrailsConfig: guardrailsConfigSchema.nullable().optional(),
  memoryConfig: memoryConfigSchema.optional(),
  providerFallback: z.array(providerFallbackEntrySchema).optional(),
  browserEnabled: z.boolean().default(false),
  costBudgetDailyUsd: z.number().nullable().optional(),
});

export const updateChannelSchema = createChannelSchema.partial();

export const createSkillSchema = z.object({
  channelId: z.string().uuid(),
  name: z.string().min(1).max(100),
  content: z.string().min(1),
  allowedTools: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
});

export const updateSkillSchema = createSkillSchema.partial().omit({ channelId: true });

export const mcpTransportTypeSchema = z.enum(['sse', 'http', 'stdio']);

export const createMCPConfigSchema = z
  .object({
    channelId: z.string().uuid().nullable().default(null),
    serverName: z.string().min(1),
    transportType: mcpTransportTypeSchema.default('sse'),
    serverUrl: z.string().url().nullable().default(null),
    headers: z.record(z.string()).nullable().default(null),
    command: z.string().min(1).nullable().default(null),
    args: z.array(z.string()).nullable().default(null),
    env: z.record(z.string()).nullable().default(null),
    cwd: z.string().nullable().default(null),
    enabled: z.boolean().default(true),
  })
  .refine(
    (data) => {
      if (data.transportType === 'stdio') return data.command !== null;
      return data.serverUrl !== null;
    },
    {
      message: 'stdio transport requires "command"; sse/http transport requires "serverUrl"',
    },
  );

export const updateToolPolicySchema = z.object({
  channelId: z.string().uuid().nullable().default(null),
  disabledTools: z.array(z.string()),
});

export const createScheduleSchema = z.object({
  channelId: z.string().uuid(),
  name: z.string().min(1),
  cronExpression: z.string().min(1),
  prompt: z.string().min(1),
  enabled: z.boolean().default(true),
  notifyUsers: z.array(z.string()).default([]),
});

export const createApprovalPolicySchema = z.object({
  channelId: z.string().uuid(),
  toolName: z.string().min(1),
  policy: z.enum(['ask', 'allowlist', 'deny', 'auto']).default('ask'),
  allowedUsers: z.array(z.string()).default([]),
});

export const memoryCategorySchema = z.enum([
  'fact',
  'preference',
  'decision',
  'person',
  'project',
  'procedure',
]);

export const memorySaveSchema = z.object({
  content: z.string().min(1),
  category: memoryCategorySchema.default('fact'),
});

export const memorySearchSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(10),
});

export const updateMemorySchema = z.object({
  content: z.string().min(1).optional(),
  category: memoryCategorySchema.optional(),
});

export type CreateChannelInput = z.input<typeof createChannelSchema>;
export type UpdateChannelInput = z.input<typeof updateChannelSchema>;
export type CreateSkillInput = z.input<typeof createSkillSchema>;
export type UpdateSkillInput = z.input<typeof updateSkillSchema>;
export type CreateMCPConfigInput = z.input<typeof createMCPConfigSchema>;
export type CreateScheduleInput = z.input<typeof createScheduleSchema>;
export type CreateApprovalPolicyInput = z.input<typeof createApprovalPolicySchema>;
export type UpdateMemoryInput = z.input<typeof updateMemorySchema>;
