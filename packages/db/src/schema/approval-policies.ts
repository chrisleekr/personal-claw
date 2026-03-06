import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { channels } from './channels';

export const approvalPolicies = pgTable(
  'approval_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    toolName: text('tool_name').notNull(),
    policy: text('policy').notNull().default('ask'),
    allowedUsers: text('allowed_users').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('approval_policies_channel_tool_unique').on(table.channelId, table.toolName)],
);
