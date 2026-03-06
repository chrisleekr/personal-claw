import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { channels } from './channels';

export const skills = pgTable('skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  channelId: uuid('channel_id')
    .notNull()
    .references(() => channels.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  content: text('content').notNull(),
  allowedTools: text('allowed_tools').array().notNull().default([]),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
