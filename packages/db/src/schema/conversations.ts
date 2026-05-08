import type { ConversationMessage } from '@personalclaw/shared';
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { channels } from './channels';

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    externalThreadId: text('external_thread_id').notNull(),
    messages: jsonb('messages').$type<ConversationMessage[]>().notNull().default([]),
    summary: text('summary'),
    isCompacted: boolean('is_compacted').notNull().default(false),
    tokenCount: integer('token_count'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('conversations_channel_thread_unique').on(table.channelId, table.externalThreadId),
  ],
);
