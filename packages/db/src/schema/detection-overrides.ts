import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { channels } from './channels';

/**
 * Per-channel override entries for the injection detection pipeline (FR-033).
 *
 * The base attack corpus lives in `packages/shared/src/injection-corpus/signatures.json`
 * and is immutable at runtime (FR-032) — updates only land via PR review. This
 * table provides the live-updatable complement: admins can suppress specific
 * base-corpus signatures for their channel (to relieve false positives), add
 * channel-specific block phrases, or trust specific MCP tools for their channel.
 *
 * Three `override_kind` values:
 * - `allowlist_signature` — `target_key` is a `signature_id` from the base corpus
 * - `block_phrase` — `target_key` is a raw phrase (3-500 chars)
 * - `trust_mcp_tool` — `target_key` is an MCP tool name enabled for the channel
 *
 * The `unique (channel_id, override_kind, target_key)` constraint prevents
 * duplicate overrides. Updates only modify `justification`; changing
 * `target_key` or `override_kind` requires delete + insert.
 *
 * Channel admins can edit these overrides via the detection-overrides HTTP
 * endpoints in `apps/api/src/routes/detection-overrides.ts`. The pipeline
 * reads overrides at detect-time via the config cache, so changes take effect
 * within one cache refresh cycle (FR-018).
 */
export const detectionOverrides = pgTable(
  'detection_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    overrideKind: text('override_kind').notNull(),
    targetKey: text('target_key').notNull(),
    justification: text('justification').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('detection_overrides_channel_idx').on(table.channelId),
    unique('detection_overrides_channel_kind_key_unique').on(
      table.channelId,
      table.overrideKind,
      table.targetKey,
    ),
  ],
);
