import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { channels } from './channels';
import { mcpConfigs } from './mcp-configs';

export const toolPolicies = pgTable('tool_policies', {
  id: uuid('id').primaryKey().defaultRandom(),
  channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'cascade' }),
  mcpConfigId: uuid('mcp_config_id')
    .notNull()
    .references(() => mcpConfigs.id, { onDelete: 'cascade' }),
  allowList: text('allow_list').array().notNull().default([]),
  denyList: text('deny_list').array().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
