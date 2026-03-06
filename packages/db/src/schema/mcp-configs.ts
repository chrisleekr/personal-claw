import { boolean, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { channels } from './channels';

export const mcpConfigs = pgTable(
  'mcp_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'cascade' }),
    serverName: text('server_name').notNull(),
    transportType: text('transport_type').notNull().default('sse'),
    serverUrl: text('server_url'),
    headers: jsonb('headers'),
    command: text('command'),
    args: jsonb('args'),
    env: jsonb('env'),
    cwd: text('cwd'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('mcp_configs_channel_server_unique').on(table.channelId, table.serverName)],
);
