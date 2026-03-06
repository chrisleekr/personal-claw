import {
  DEFAULT_HEARTBEAT_CRON,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_MEMORY_CONFIG,
  DEFAULT_MODEL,
  DEFAULT_PROMPT_INJECT_MODE,
  DEFAULT_PROVIDER,
} from '@personalclaw/shared';
import {
  boolean,
  decimal,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const channels = pgTable(
  'channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    platform: text('platform').notNull().default('slack'),
    externalId: text('external_id').notNull(),
    externalName: text('external_name'),
    identityPrompt: text('identity_prompt'),
    teamPrompt: text('team_prompt'),
    model: text('model').notNull().default(DEFAULT_MODEL),
    provider: text('provider').notNull().default(DEFAULT_PROVIDER),
    maxIterations: integer('max_iterations').notNull().default(DEFAULT_MAX_ITERATIONS),
    guardrailsConfig: jsonb('guardrails_config'),
    sandboxEnabled: boolean('sandbox_enabled').notNull().default(true),
    sandboxConfig: jsonb('sandbox_config'),
    heartbeatEnabled: boolean('heartbeat_enabled').notNull().default(false),
    heartbeatPrompt: text('heartbeat_prompt'),
    heartbeatCron: text('heartbeat_cron').notNull().default(DEFAULT_HEARTBEAT_CRON),
    memoryConfig: jsonb('memory_config').notNull().default(DEFAULT_MEMORY_CONFIG),
    promptInjectMode: text('prompt_inject_mode').notNull().default(DEFAULT_PROMPT_INJECT_MODE),
    providerFallback: jsonb('provider_fallback')
      .notNull()
      .default([{ provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL }]),
    browserEnabled: boolean('browser_enabled').notNull().default(false),
    costBudgetDailyUsd: decimal('cost_budget_daily_usd', { precision: 10, scale: 2 }),
    threadReplyMode: text('thread_reply_mode').notNull().default('all'),
    autonomyLevel: text('autonomy_level').notNull().default('balanced'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('channels_platform_external_id_idx').on(table.platform, table.externalId)],
);
