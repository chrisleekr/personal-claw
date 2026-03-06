import { integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { channels } from './channels';
import { skills } from './skills';

export const workflowPatterns = pgTable(
  'workflow_patterns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    patternHash: text('pattern_hash').notNull(),
    toolSequence: text('tool_sequence').array().notNull(),
    description: text('description'),
    occurrenceCount: integer('occurrence_count').notNull().default(1),
    successCount: integer('success_count').notNull().default(0),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    generatedSkillId: uuid('generated_skill_id').references(() => skills.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('workflow_patterns_channel_hash_unique').on(table.channelId, table.patternHash),
  ],
);
