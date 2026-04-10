import { boolean, index, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { channels } from './channels';

/**
 * System-of-record table for every block / flag / above-threshold allow decision
 * produced by the multi-layer injection detection pipeline.
 *
 * Per FR-026 in the spec: this table is the authoritative store — no code path
 * may treat a hook emission or log line as the durable audit record. The matching
 * `guardrail:detection` hook (FR-027) is a best-effort side-channel only.
 *
 * Retention is bounded by the per-channel `auditRetentionDays` configuration
 * (default 7, bounded [1, 90]) and enforced by the cron job in
 * `apps/api/src/cron/audit-cleanup.ts` (FR-022, FR-028).
 *
 * Constitution III (Channel Isolation): every query against this table MUST be
 * scoped by `channel_id`. The FK cascade ensures rows are removed when a
 * channel is deleted.
 *
 * Indexes:
 * - `(channel_id, created_at DESC)` — primary query path for the admin recent-blocks view (FR-015) and the retention cleanup job
 * - `(decision, created_at DESC)` — aggregate dashboards grouped by decision type
 * - `reference_id` unique — supports FR-004 lookup by the reference id surfaced to end-users
 */
export const detectionAuditEvents = pgTable(
  'detection_audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    externalUserId: text('external_user_id').notNull(),
    threadId: text('thread_id'),
    decision: text('decision').notNull(),
    riskScore: numeric('risk_score', { precision: 5, scale: 2 }).notNull(),
    layersFired: text('layers_fired').array().notNull().default([]),
    reasonCode: text('reason_code').notNull(),
    redactedExcerpt: text('redacted_excerpt').notNull(),
    referenceId: text('reference_id').notNull().unique(),
    sourceKind: text('source_kind').notNull(),
    canaryHit: boolean('canary_hit').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('detection_audit_events_channel_created_idx').on(table.channelId, table.createdAt),
    index('detection_audit_events_decision_created_idx').on(table.decision, table.createdAt),
  ],
);
