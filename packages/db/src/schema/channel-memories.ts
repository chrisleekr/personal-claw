// pgvector 'embedding vector(1024)' and tsvector 'search_vector' columns added via raw SQL migration
import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { channels } from './channels';

export const channelMemories = pgTable(
  'channel_memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    category: text('category').notNull().default('fact'),
    sourceThreadId: text('source_thread_id'),
    recallCount: integer('recall_count').notNull().default(0),
    lastRecalledAt: timestamp('last_recalled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('channel_memories_channel_idx').on(table.channelId)],
);
