import { getLogger } from '@logtape/logtape';
import { and, channels, detectionAuditEvents, eq, lt, sql } from '@personalclaw/db';
import { guardrailsConfigSchema } from '@personalclaw/shared';
import cron from 'node-cron';
import { getDb } from '../db';
import { errorDetails } from '../utils/error-fmt';

/**
 * FR-022 / FR-028 — Retention cleanup for `detection_audit_events`.
 *
 * The detection pipeline persists an audit event for every block, flag,
 * neutralize, and above-threshold allow decision (see `writeAuditEvent()`
 * in `apps/api/src/agent/detection/audit.ts`). Per spec FR-022 these rows
 * have a bounded lifetime governed by each channel's `auditRetentionDays`
 * (default 7, bounded [1, 90]).
 *
 * FR-028 requires TWO trigger mechanisms that call the same shared deletion
 * function (no drift):
 *
 *   (a) a system-level internal cron job registered at API startup,
 *       running at least once every 24 hours — implemented by
 *       `initAuditCleanup()` below, scheduled via `node-cron` using the
 *       same pattern as `apps/api/src/cron/heartbeat.ts` and
 *       `apps/api/src/cron/runner.ts`.
 *
 *   (b) an admin-only authenticated HTTP endpoint — implemented by
 *       `apps/api/src/routes/detection-audit.ts`'s
 *       `POST /api/guardrails/audit/cleanup` handler, which calls
 *       `cleanupAuditEvents()` synchronously and returns the deletion
 *       report as a JSON response.
 *
 * Both paths share `cleanupAuditEvents()` below so there is exactly one
 * place where the deletion SQL lives.
 *
 * FR-017 (no silent failure): failures surface via `logger.error` and the
 * outer catches let the error propagate to the caller. The HTTP endpoint
 * converts errors into a 500 response; the cron path catches at the top
 * level so a failed sweep does not crash the process but DOES log the
 * error with full context.
 *
 * Constitution III (Channel Isolation): every DELETE is scoped by
 * `channel_id` via the Drizzle `eq(detectionAuditEvents.channelId, ...)`
 * predicate. Running the all-channels sweep iterates channels serially
 * so each delete stays scoped.
 *
 * Spec anchors: FR-017, FR-022, FR-028, tasks.md T074, T077, T078.
 */

const logger = getLogger(['personalclaw', 'cron', 'audit-cleanup']);

/** Default retention window when a channel has no explicit `auditRetentionDays`. */
const DEFAULT_RETENTION_DAYS = 7;

/** How many days the retention window is clamped to as a safety ceiling. */
const MAX_RETENTION_DAYS = 90;
const MIN_RETENTION_DAYS = 1;

/**
 * Shape of the object that both `cleanupAuditEvents()` and the HTTP
 * endpoint return. The keys of `deletedByChannel` are channel UUIDs and
 * the values are the number of rows removed for that channel in this
 * sweep. `totalDeleted` is the sum across all keys. `durationMs` is the
 * wall time of the full operation, useful for cron diagnostics.
 */
export interface AuditCleanupReport {
  deletedByChannel: Record<string, number>;
  totalDeleted: number;
  durationMs: number;
}

/**
 * Reads a channel's effective `auditRetentionDays` from its
 * `guardrailsConfig` JSONB row. Falls back to the 7-day default when the
 * field is absent or the config fails to parse. The value is clamped to
 * the spec-mandated `[1, 90]` range so a malformed row cannot cause a
 * runaway retention window.
 */
function resolveRetentionDays(guardrailsConfig: unknown): number {
  if (!guardrailsConfig || typeof guardrailsConfig !== 'object') {
    return DEFAULT_RETENTION_DAYS;
  }
  const parsed = guardrailsConfigSchema.safeParse(guardrailsConfig);
  if (!parsed.success) {
    return DEFAULT_RETENTION_DAYS;
  }
  const days = parsed.data.auditRetentionDays ?? DEFAULT_RETENTION_DAYS;
  return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, days));
}

/**
 * Shared deletion function called by both the scheduled cron job and the
 * `POST /api/guardrails/audit/cleanup` HTTP endpoint (FR-028).
 *
 * @param channelId - When provided, cleanup runs ONLY for this channel.
 *   When omitted, cleanup iterates every channel in the database and
 *   applies each channel's own `auditRetentionDays`.
 *
 * @returns A report mapping each processed channel id to the number of
 *   rows removed plus the total and wall-clock duration.
 *
 * @throws Errors from the DB are NOT swallowed. Callers must decide whether
 *   to convert them into HTTP 500 or just log-and-continue (the cron does).
 */
export async function cleanupAuditEvents(channelId?: string): Promise<AuditCleanupReport> {
  const start = performance.now();
  const deletedByChannel: Record<string, number> = {};

  const db = getDb();
  const channelRows = channelId
    ? await db
        .select({ id: channels.id, guardrailsConfig: channels.guardrailsConfig })
        .from(channels)
        .where(eq(channels.id, channelId))
    : await db
        .select({ id: channels.id, guardrailsConfig: channels.guardrailsConfig })
        .from(channels);

  for (const channel of channelRows) {
    const retentionDays = resolveRetentionDays(channel.guardrailsConfig);
    // `now() - (N || ' days')::interval` computes a timestamp N days ago in
    // Postgres; we use `sql` raw fragments because drizzle doesn't yet have
    // a high-level interval helper. The `lt` comparator is parameter-safe
    // for the channel id match — only the interval expression uses raw SQL.
    const deleted = await db
      .delete(detectionAuditEvents)
      .where(
        and(
          eq(detectionAuditEvents.channelId, channel.id),
          lt(
            detectionAuditEvents.createdAt,
            sql`now() - (${retentionDays}::int || ' days')::interval`,
          ),
        ),
      )
      .returning({ id: detectionAuditEvents.id });

    deletedByChannel[channel.id] = deleted.length;
  }

  const totalDeleted = Object.values(deletedByChannel).reduce((sum, n) => sum + n, 0);
  const durationMs = Math.round(performance.now() - start);

  logger.info('Audit cleanup sweep complete', {
    scope: channelId ?? 'all-channels',
    channelsProcessed: channelRows.length,
    totalDeleted,
    durationMs,
  });

  return { deletedByChannel, totalDeleted, durationMs };
}

/**
 * Daily cron-registered wrapper around `cleanupAuditEvents()` that sweeps
 * every channel. Errors are caught at the top level so a failed sweep does
 * not crash the process, but they ARE logged with full context per FR-017
 * so an operator can see that under-deletion happened.
 */
async function runScheduledCleanup(): Promise<void> {
  try {
    const report = await cleanupAuditEvents();
    logger.info('Scheduled audit cleanup completed', {
      channels: Object.keys(report.deletedByChannel).length,
      totalDeleted: report.totalDeleted,
      durationMs: report.durationMs,
    });
  } catch (error) {
    logger.error('Scheduled audit cleanup FAILED — audit table may be over-retained', {
      ...errorDetails(error),
    });
  }
}

let cleanupTask: cron.ScheduledTask | null = null;

/**
 * Cron expression for the daily sweep. Runs at 03:15 UTC to stay out of
 * the path of the existing 03:00 memory decay cleanup (`memory/decay.ts`)
 * while still landing in the low-traffic early-morning window.
 */
const DAILY_CLEANUP_CRON = '15 3 * * *';

/**
 * Registers the daily audit retention cleanup cron. Idempotent — calling
 * twice in the same process stops the previous task before registering
 * the new one, so hot-reload during dev does not leave orphaned timers.
 *
 * The cron job is independent of the per-channel heartbeat cron from
 * `apps/api/src/cron/heartbeat.ts` and the schedule runner from
 * `apps/api/src/cron/runner.ts`. This function is called once from
 * `main()` in `apps/api/src/index.ts` (T078).
 */
export function initAuditCleanup(): void {
  if (cleanupTask) {
    cleanupTask.stop();
    cleanupTask = null;
  }

  if (!cron.validate(DAILY_CLEANUP_CRON)) {
    logger.error('Audit cleanup cron expression is invalid — aborting registration', {
      expression: DAILY_CLEANUP_CRON,
    });
    return;
  }

  cleanupTask = cron.schedule(DAILY_CLEANUP_CRON, () => {
    runScheduledCleanup();
  });

  logger.info('Registered daily audit cleanup cron', { expression: DAILY_CLEANUP_CRON });
}
