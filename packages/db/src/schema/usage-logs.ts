import { decimal, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { channels } from './channels';

export const usageLogs = pgTable(
  'usage_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    externalUserId: text('external_user_id').notNull(),
    externalThreadId: text('external_thread_id'),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    promptTokens: integer('prompt_tokens').notNull(),
    completionTokens: integer('completion_tokens').notNull(),
    totalTokens: integer('total_tokens').notNull(),
    estimatedCostUsd: decimal('estimated_cost_usd', { precision: 10, scale: 6 }),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('usage_logs_channel_created_idx').on(table.channelId, table.createdAt),
    index('usage_logs_user_created_idx').on(table.externalUserId, table.createdAt),
  ],
);
