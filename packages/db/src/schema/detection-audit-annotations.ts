import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { channels } from './channels';
import { detectionAuditEvents } from './detection-audit-events';

/**
 * Per-row admin annotations on `detection_audit_events`.
 *
 * Audit events are immutable (FR-026). Admin triage actions such as marking
 * a block as a false positive live in this side-table so the underlying
 * event is never mutated. Cascade delete from the parent event means the
 * retention job that removes old audit rows also removes their annotations.
 *
 * FR-015 (admin recent-blocks view): the admin UI joins this table to show
 * triage state alongside each audit row.
 *
 * The `unique (audit_event_id, annotated_by)` constraint enforces one
 * annotation per admin per event — repeated triage by the same admin replaces
 * the old annotation via delete+insert rather than collecting a history.
 *
 * `channel_id` is denormalized (not strictly required since it is reachable
 * via the audit event) so the channel-scoped list query does not need a join
 * and remains fast on the `(channel_id, created_at DESC)` index.
 */
export const detectionAuditAnnotations = pgTable(
  'detection_audit_annotations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    auditEventId: uuid('audit_event_id')
      .notNull()
      .references(() => detectionAuditEvents.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    annotationKind: text('annotation_kind').notNull(),
    annotatedBy: text('annotated_by').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('detection_audit_annotations_channel_created_idx').on(table.channelId, table.createdAt),
    index('detection_audit_annotations_event_idx').on(table.auditEventId),
    unique('detection_audit_annotations_event_annotator_unique').on(
      table.auditEventId,
      table.annotatedBy,
    ),
  ],
);
