import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { channels } from './channels';

export const schedules = pgTable('schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  channelId: uuid('channel_id')
    .notNull()
    .references(() => channels.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  cronExpression: text('cron_expression').notNull(),
  prompt: text('prompt').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  notifyUsers: text('notify_users').array().notNull().default([]),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
