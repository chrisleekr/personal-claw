import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { channels } from './channels';
import { skills } from './skills';

export const skillUsages = pgTable(
  'skill_usages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    externalUserId: text('external_user_id').notNull(),
    wasHelpful: boolean('was_helpful'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('skill_usages_skill_idx').on(table.skillId),
    index('skill_usages_channel_idx').on(table.channelId),
  ],
);
