import { z } from 'zod';
import {
  DEFAULT_HEARTBEAT_CRON,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_MODEL,
  DEFAULT_PROMPT_INJECT_MODE,
  DEFAULT_PROVIDER,
} from './constants';
import {
  ALLOWED_STDIO_COMMANDS,
  BLOCKED_ENV_KEYS,
  BLOCKED_EVAL_FLAGS,
  hasEvalFlag,
  MAX_STDIO_ARG_LENGTH,
  MAX_STDIO_ARGS_COUNT,
  MAX_STDIO_CWD_LENGTH,
  SHELL_METACHAR_PATTERN,
} from './mcp-security';

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
      'git',
      'node',
      'npx',
      'bun',
      'bunx',
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
      'sort',
      'uniq',
      'mkdir',
      'cp',
      'mv',
      'touch',
      'echo',
    ]),
  deniedPatterns: z
    .array(z.string())
    .default(['\\brm\\s+(-\\w+\\s+)*\\/', '\\bmkfs\\b', '\\bdd\\b.*\\bif='])
    .refine(
      (patterns) => {
        // Reject patterns with nested quantifiers on capturing/non-capturing groups
        // that cause catastrophic backtracking (ReDoS).
        // Catches: (a+)+, (x+)*, (.*)+, (\w+)+ but NOT (-[a-z]*foo\s+)* (single quantifier on group).
        // The key indicator is a quantifier (+, *) applied to a group that itself
        // contains a quantifier (+, *) applied to a group (not just a character class).
        const groupWithQuantifiedGroup = /\([^)]*\([^)]*\)[+*][^)]*\)[+*]/;
        // Simple repeating groups: (a+)+  where the group content ends with +/*
        const simpleNestedQuantifier = /\([\w.\\]+[+*]\)[+*]/;
        // Character class with quantifier in a quantified group: ([a-z]+)+, ([\w]+)*
        const classQuantifiedGroup = /\(\[[^\]]*\][+*]\)[+*]/;
        for (const p of patterns) {
          try {
            new RegExp(p);
          } catch {
            return false;
          }
          if (
            groupWithQuantifiedGroup.test(p) ||
            simpleNestedQuantifier.test(p) ||
            classQuantifiedGroup.test(p)
          )
            return false;
        }
        return true;
      },
      {
        message:
          'One or more deniedPatterns contain invalid or potentially unsafe regex (ReDoS risk)',
      },
    ),
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

export const approvalTimeoutMsSchema = z.number().int().min(60_000).max(3_600_000).default(600_000);
export const channelAdminsSchema = z.array(z.string().min(1)).default([]);

export const updateChannelSchema = createChannelSchema
  .extend({
    approvalTimeoutMs: approvalTimeoutMsSchema.optional(),
    channelAdmins: channelAdminsSchema.optional(),
  })
  .partial();

export const createSkillSchema = z.object({
  channelId: z.string().uuid(),
  name: z.string().min(1).max(100),
  content: z.string().min(1),
  allowedTools: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
});

export const updateSkillSchema = createSkillSchema.partial().omit({ channelId: true });

export const mcpTransportTypeSchema = z.enum(['sse', 'http', 'stdio']);

/** Zod schema for a single stdio arg: bounded length. */
export const stdioArgSchema = z
  .string()
  .max(MAX_STDIO_ARG_LENGTH, `Arg must be at most ${MAX_STDIO_ARG_LENGTH} characters`);

/** Zod schema for stdio args array: bounded count, validated elements. */
export const stdioArgsSchema = z
  .array(stdioArgSchema)
  .max(MAX_STDIO_ARGS_COUNT, `At most ${MAX_STDIO_ARGS_COUNT} args allowed`)
  .refine((args) => !args.some((a) => SHELL_METACHAR_PATTERN.test(a)), {
    message:
      'Args must not contain shell metacharacters or control characters (e.g. ;, |, &, <, >, `, $(), $\\{}, newlines, or null bytes)',
  })
  .refine((args) => !hasEvalFlag(args), {
    message: `Args must not contain eval/exec flags: ${[...BLOCKED_EVAL_FLAGS].join(', ')}`,
  });

/** Zod schema for stdio env: rejects dangerous env var keys. */
export const stdioEnvSchema = z
  .record(z.string())
  .refine((env) => !Object.keys(env).some((k) => BLOCKED_ENV_KEYS.has(k.toUpperCase())), {
    message: `Blocked environment variable detected. Disallowed keys: ${[...BLOCKED_ENV_KEYS].join(', ')}`,
  });

/** Zod schema for stdio cwd: bounded length, no path traversal. */
export const stdioCwdSchema = z
  .string()
  .max(MAX_STDIO_CWD_LENGTH, `cwd must be at most ${MAX_STDIO_CWD_LENGTH} characters`)
  .refine((cwd) => !/(^|[\\/])\.\.($|[\\/])/.test(cwd), {
    message: 'cwd must not contain path traversal (..)',
  });

/** Zod schema for stdio command: must be in the allowlist. */
export const stdioCommandSchema = z
  .string()
  .min(1)
  .refine((cmd) => ALLOWED_STDIO_COMMANDS.has(cmd), {
    message: `Command must be one of: ${[...ALLOWED_STDIO_COMMANDS].join(', ')}`,
  });

export const createMCPConfigSchema = z
  .object({
    channelId: z.string().uuid().nullable().default(null),
    serverName: z.string().min(1),
    transportType: mcpTransportTypeSchema.default('sse'),
    serverUrl: z.string().url().nullable().default(null),
    headers: z.record(z.string()).nullable().default(null),
    command: stdioCommandSchema.nullable().default(null),
    args: stdioArgsSchema.nullable().default(null),
    env: stdioEnvSchema.nullable().default(null),
    cwd: stdioCwdSchema.nullable().default(null),
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
