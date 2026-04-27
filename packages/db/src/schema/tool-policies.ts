import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { channels } from './channels';
import { mcpConfigs } from './mcp-configs';

export const toolPolicies = pgTable(
  'tool_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'cascade' }),
    mcpConfigId: uuid('mcp_config_id')
      .notNull()
      .references(() => mcpConfigs.id, { onDelete: 'cascade' }),
    allowList: text('allow_list').array().notNull().default([]),
    denyList: text('deny_list').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('tool_policies_mcp_config_channel_unique')
      .on(table.mcpConfigId, table.channelId)
      .where(sql`${table.channelId} IS NOT NULL`),
    uniqueIndex('tool_policies_mcp_config_global_unique')
      .on(table.mcpConfigId)
      .where(sql`${table.channelId} IS NULL`),
  ],
);
