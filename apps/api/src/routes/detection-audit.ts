import { getLogger } from '@logtape/logtape';
import {
  and,
  channels,
  desc,
  detectionAuditAnnotations,
  detectionAuditEvents,
  eq,
  gte,
  inArray,
  lte,
  sql,
} from '@personalclaw/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { cleanupAuditEvents } from '../cron/audit-cleanup';
import { getDb } from '../db';
import { errorDetails } from '../utils/error-fmt';

/**
 * FR-015 / FR-022 / FR-028 — Detection audit admin endpoints.
 *
 * This route file is deliberately separate from
 * `apps/api/src/routes/detection-overrides.ts` per analysis finding D1 so
 * Phase 4 (overrides) and Phase 5 (audit) edit different files and can
 * merge independently.
 *
 * Endpoints (the two-segment sub-paths are mounted under `/api/channels`
 * in `apps/api/src/index.ts`, and the cleanup endpoint is mounted under
 * `/api/guardrails/audit` separately because it uses a different base
 * prefix):
 *
 *   GET  /:channelId/detection-audit/recent             (channel-scoped)
 *   GET  /:channelId/detection-audit/by-reference/:referenceId
 *   POST /:channelId/detection-audit/:auditEventId/annotate
 *   POST /api/guardrails/audit/cleanup                   (different prefix)
 *
 * Auth model:
 *
 *   - The bearer token (`API_SECRET`) is enforced by the app-level
 *     `authMiddleware` before the request reaches this handler.
 *   - GET and POST on the channel-scoped paths require an `X-User-Id`
 *     header identifying the caller, and the handler verifies that user
 *     id is in `channels.channelAdmins` for the target channel. This
 *     matches the detection-overrides route auth model added in Phase 4.
 *   - The cleanup endpoint uses a slightly different rule per the
 *     contract: when `channelId` is provided in the body the handler
 *     does a channel-admin check; when `channelId` is omitted (all-
 *     channels sweep) it requires the caller to be a GLOBAL admin,
 *     which we approximate by requiring the caller id to be in the
 *     env-var `GLOBAL_ADMIN_USER_IDS` comma-separated list. Operators
 *     who have not configured that env var get a 403 with a clear
 *     message instead of a silent allow.
 *
 * Spec anchors: FR-004 (reference_id lookup), FR-015 (admin recent
 * view), FR-017 (no silent failure in cleanup), FR-022 (retention
 * window), FR-028 (two trigger paths share a single deletion function),
 * tasks.md T075, T076, contracts/detection-audit.http,
 * contracts/detection-audit-cleanup.http.
 */

const logger = getLogger(['personalclaw', 'routes', 'detection-audit']);

/** Postgres unique-violation SQLSTATE — reused from detection-overrides. */
const PG_UNIQUE_VIOLATION = '23505';

/** Default page size for the `/recent` list endpoint. Max is 200 per the contract. */
const DEFAULT_RECENT_LIMIT = 50;
const MAX_RECENT_LIMIT = 200;

// ---------------------------------------------------------------------------
// Zod schemas — local to this file because they are route-level validation
// concerns rather than durable cross-package types.
// ---------------------------------------------------------------------------

export const DECISION_KINDS = ['allow', 'flag', 'neutralize', 'block'] as const;
export type AuditDecisionKind = (typeof DECISION_KINDS)[number];

export const ANNOTATION_KINDS = [
  'false_positive',
  'confirmed_true_positive',
  'under_review',
] as const;
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

/** Query-string schema for GET /:channelId/detection-audit/recent. */
const recentQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_RECENT_LIMIT).optional(),
  cursor: z.string().optional(),
  decision: z.enum(DECISION_KINDS).optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
});

/** POST body schema for the annotate endpoint. */
const annotateBodySchema = z.object({
  annotationKind: z.enum(ANNOTATION_KINDS),
  note: z.string().max(2000).optional(),
});

/** POST body schema for the cleanup endpoint. */
const cleanupBodySchema = z.object({
  channelId: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// Cursor encoding — opaque base64 of createdAt+id so clients don't try to
// fabricate or mutate it. The cursor format is the ISO timestamp of the
// last row returned, followed by a tab, followed by the row id. Decoding
// is best-effort: invalid cursors simply restart from the newest row.
// ---------------------------------------------------------------------------

function encodeCursor(createdAt: Date, id: string): string {
  const raw = `${createdAt.toISOString()}\t${id}`;
  return Buffer.from(raw, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const [isoTs, id] = raw.split('\t');
    if (!isoTs || !id) return null;
    const d = new Date(isoTs);
    if (Number.isNaN(d.getTime())) return null;
    return { createdAt: d, id };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Admin-check helpers — mirror the pattern from detection-overrides.ts but
// kept local rather than re-exported to avoid coupling the two routes.
// ---------------------------------------------------------------------------

interface AdminCheckFailure {
  ok: false;
  status: 400 | 403 | 404;
  message: string;
}
interface AdminCheckSuccess {
  ok: true;
  userId: string;
}

async function requireChannelAdmin(
  channelId: string,
  userIdHeader: string | undefined,
): Promise<AdminCheckSuccess | AdminCheckFailure> {
  if (!userIdHeader) {
    return {
      ok: false,
      status: 400,
      message: 'X-User-Id header is required for this operation',
    };
  }
  const db = getDb();
  const [channel] = await db
    .select({ channelAdmins: channels.channelAdmins })
    .from(channels)
    .where(eq(channels.id, channelId));
  if (!channel) {
    return { ok: false, status: 404, message: `channel ${channelId} not found` };
  }
  const admins = channel.channelAdmins ?? [];
  if (!admins.includes(userIdHeader)) {
    return {
      ok: false,
      status: 403,
      message: `user ${userIdHeader} is not a channel admin for ${channelId}`,
    };
  }
  return { ok: true, userId: userIdHeader };
}

/**
 * Returns `true` if the given user id is in the comma-separated
 * `GLOBAL_ADMIN_USER_IDS` env var. Used by the all-channels cleanup path.
 * When the env var is unset, returns `false` — operators who have not
 * configured it get an explicit 403 rather than a silent allow.
 */
function isGlobalAdmin(userId: string): boolean {
  const raw = process.env.GLOBAL_ADMIN_USER_IDS ?? '';
  if (!raw.trim()) return false;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(userId);
}

// ---------------------------------------------------------------------------
// Shape helpers for the response JSON
// ---------------------------------------------------------------------------

interface AuditEventRow {
  id: string;
  channelId: string;
  externalUserId: string;
  threadId: string | null;
  decision: string;
  riskScore: string; // numeric from drizzle → string
  layersFired: string[];
  reasonCode: string;
  redactedExcerpt: string;
  referenceId: string;
  sourceKind: string;
  canaryHit: boolean;
  createdAt: Date;
}

interface AnnotationRow {
  id: string;
  auditEventId: string;
  annotationKind: string;
  annotatedBy: string;
  note: string | null;
  createdAt: Date;
}

/**
 * Joins audit-event rows with their annotations (if any) and returns the
 * response shape documented in `contracts/detection-audit.http`. The join
 * is done client-side in JS rather than via a SQL left join because the
 * annotations are a many-per-event relation and the per-event grouping is
 * cleaner in code than in a GROUP BY clause.
 */
async function loadAnnotationsForEvents(eventIds: string[]): Promise<Map<string, AnnotationRow[]>> {
  if (eventIds.length === 0) return new Map();
  const db = getDb();
  const rows: AnnotationRow[] = await db
    .select({
      id: detectionAuditAnnotations.id,
      auditEventId: detectionAuditAnnotations.auditEventId,
      annotationKind: detectionAuditAnnotations.annotationKind,
      annotatedBy: detectionAuditAnnotations.annotatedBy,
      note: detectionAuditAnnotations.note,
      createdAt: detectionAuditAnnotations.createdAt,
    })
    .from(detectionAuditAnnotations)
    .where(inArray(detectionAuditAnnotations.auditEventId, eventIds));

  const byEvent = new Map<string, AnnotationRow[]>();
  for (const row of rows) {
    const list = byEvent.get(row.auditEventId) ?? [];
    list.push(row);
    byEvent.set(row.auditEventId, list);
  }
  return byEvent;
}

function serializeEvent(
  row: AuditEventRow,
  annotations: AnnotationRow[] | undefined,
): Record<string, unknown> {
  return {
    id: row.id,
    channelId: row.channelId,
    externalUserId: row.externalUserId,
    threadId: row.threadId,
    decision: row.decision,
    riskScore: Number(row.riskScore),
    layersFired: row.layersFired,
    reasonCode: row.reasonCode,
    redactedExcerpt: row.redactedExcerpt,
    referenceId: row.referenceId,
    sourceKind: row.sourceKind,
    canaryHit: row.canaryHit,
    createdAt: row.createdAt,
    annotations: (annotations ?? []).map((a) => ({
      id: a.id,
      kind: a.annotationKind,
      annotatedBy: a.annotatedBy,
      note: a.note,
      createdAt: a.createdAt,
    })),
  };
}

// ---------------------------------------------------------------------------
// Route: channel-scoped audit endpoints (mounted at /api/channels)
// ---------------------------------------------------------------------------

export const detectionAuditRoute = new Hono();

/**
 * GET /:channelId/detection-audit/recent — paginated list of audit events
 * for a channel. Admin-only (channelAdmins membership enforced).
 *
 * Query params:
 *   limit     — 1..200, default 50
 *   cursor    — opaque base64 pagination cursor
 *   decision  — filter by allow|flag|neutralize|block
 *   since     — ISO8601 lower bound on createdAt (inclusive)
 *   until     — ISO8601 upper bound on createdAt (exclusive)
 */
detectionAuditRoute.get('/:channelId/detection-audit/recent', async (c) => {
  const channelId = c.req.param('channelId');
  const userIdHeader = c.req.header('X-User-Id');

  const adminCheck = await requireChannelAdmin(channelId, userIdHeader);
  if (!adminCheck.ok) {
    return c.json({ error: adminCheck.message }, adminCheck.status);
  }

  const query = recentQuerySchema.parse(Object.fromEntries(new URL(c.req.url).searchParams));
  const limit = query.limit ?? DEFAULT_RECENT_LIMIT;

  const db = getDb();
  const whereClauses = [eq(detectionAuditEvents.channelId, channelId)];
  if (query.decision) {
    whereClauses.push(eq(detectionAuditEvents.decision, query.decision));
  }
  if (query.since) {
    whereClauses.push(gte(detectionAuditEvents.createdAt, new Date(query.since)));
  }
  if (query.until) {
    whereClauses.push(lte(detectionAuditEvents.createdAt, new Date(query.until)));
  }
  if (query.cursor) {
    const decoded = decodeCursor(query.cursor);
    if (decoded) {
      // The cursor logic MUST stay entirely inside SQL to preserve the
      // microsecond precision of `created_at`. Round-tripping through a
      // js `Date` truncates to milliseconds and batch-inserted rows that
      // share a microsecond-precision timestamp get silently dropped
      // between pages (smoke-test bug found 2026-04-10 and confirmed
      // twice: once when using `new Date(iso)` from the decoded cursor,
      // once again when looking up the cursor row from the db and
      // reading its `createdAt` as a js Date).
      //
      // Postgres tuple comparison `(a, b) < (c, d)` expands to
      // `a < c OR (a = c AND b < d)`, which is exactly the standard
      // cursor pattern for a `(created_at DESC, id DESC)` ordering.
      // Wrapping it in a subquery against `detection_audit_events`
      // indexed on `id` keeps the microsecond precision end-to-end.
      whereClauses.push(
        sql`(${detectionAuditEvents.createdAt}, ${detectionAuditEvents.id}) < (SELECT created_at, id FROM detection_audit_events WHERE id = ${decoded.id})`,
      );
    }
  }

  const rows: AuditEventRow[] = await db
    .select()
    .from(detectionAuditEvents)
    .where(and(...whereClauses))
    // Secondary sort on `id DESC` so tied timestamps have a deterministic
    // order that matches the tuple comparison in the cursor predicate above.
    // Without this, the cursor could skip rows under identical timestamps.
    .orderBy(desc(detectionAuditEvents.createdAt), desc(detectionAuditEvents.id))
    .limit(limit + 1); // fetch one extra row to determine nextCursor

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore
    ? encodeCursor(pageRows[pageRows.length - 1].createdAt, pageRows[pageRows.length - 1].id)
    : null;

  const annotations = await loadAnnotationsForEvents(pageRows.map((r) => r.id));
  const events = pageRows.map((row) => serializeEvent(row, annotations.get(row.id)));

  return c.json({ data: { events, nextCursor } });
});

/**
 * GET /:channelId/detection-audit/by-reference/:referenceId — looks up a
 * single audit event by the reference id surfaced to end users per FR-004.
 */
detectionAuditRoute.get('/:channelId/detection-audit/by-reference/:referenceId', async (c) => {
  const channelId = c.req.param('channelId');
  const referenceId = c.req.param('referenceId');
  const userIdHeader = c.req.header('X-User-Id');

  const adminCheck = await requireChannelAdmin(channelId, userIdHeader);
  if (!adminCheck.ok) {
    return c.json({ error: adminCheck.message }, adminCheck.status);
  }

  const db = getDb();
  const [row] = (await db
    .select()
    .from(detectionAuditEvents)
    .where(
      and(
        eq(detectionAuditEvents.channelId, channelId),
        eq(detectionAuditEvents.referenceId, referenceId),
      ),
    )
    .limit(1)) as AuditEventRow[];

  if (!row) {
    return c.json(
      { error: `audit event with reference_id=${referenceId} not found for channel ${channelId}` },
      404,
    );
  }

  const annotations = await loadAnnotationsForEvents([row.id]);
  return c.json({ data: serializeEvent(row, annotations.get(row.id)) });
});

/**
 * POST /:channelId/detection-audit/:auditEventId/annotate — records an
 * admin triage annotation on an existing audit event. The
 * `(auditEventId, annotatedBy)` unique constraint means each admin can
 * have exactly one annotation per event; re-triaging requires delete +
 * insert (not implemented here — the current workflow is single-shot).
 */
detectionAuditRoute.post('/:channelId/detection-audit/:auditEventId/annotate', async (c) => {
  const channelId = c.req.param('channelId');
  const auditEventId = c.req.param('auditEventId');
  const userIdHeader = c.req.header('X-User-Id');

  const adminCheck = await requireChannelAdmin(channelId, userIdHeader);
  if (!adminCheck.ok) {
    return c.json({ error: adminCheck.message }, adminCheck.status);
  }

  const body = annotateBodySchema.parse(await c.req.json());

  const db = getDb();
  // Verify the audit event exists AND belongs to this channel before
  // inserting the annotation. Skipping this would let an admin annotate
  // events in OTHER channels they administer, which Constitution III
  // prohibits.
  const [event] = await db
    .select({ id: detectionAuditEvents.id, channelId: detectionAuditEvents.channelId })
    .from(detectionAuditEvents)
    .where(
      and(eq(detectionAuditEvents.id, auditEventId), eq(detectionAuditEvents.channelId, channelId)),
    )
    .limit(1);

  if (!event) {
    return c.json(
      {
        error: `audit event ${auditEventId} not found for channel ${channelId} (may have been deleted by retention)`,
      },
      404,
    );
  }

  try {
    const [row] = await db
      .insert(detectionAuditAnnotations)
      .values({
        auditEventId,
        channelId,
        annotationKind: body.annotationKind,
        annotatedBy: adminCheck.userId,
        note: body.note,
      })
      .returning();
    logger.info('detection audit annotation created', {
      channelId,
      auditEventId,
      annotationKind: row.annotationKind,
      annotatedBy: row.annotatedBy,
    });
    return c.json({ data: row }, 201);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === PG_UNIQUE_VIOLATION) {
      return c.json(
        {
          error: 'DUPLICATE_ANNOTATION',
          message: `user ${adminCheck.userId} has already annotated audit event ${auditEventId}`,
        },
        409,
      );
    }
    logger.warn('detection audit annotation insert failed', {
      channelId,
      auditEventId,
      ...errorDetails(error),
    });
    throw error;
  }
});

// ---------------------------------------------------------------------------
// Route: cleanup endpoint (mounted separately at /api/guardrails/audit)
// ---------------------------------------------------------------------------

/**
 * Separate Hono instance for the cleanup endpoint because it lives at a
 * different path prefix than the channel-scoped routes above. Registered
 * in `apps/api/src/index.ts` via its own `app.route('/api/guardrails/audit',
 * detectionAuditCleanupRoute)` call.
 */
export const detectionAuditCleanupRoute = new Hono();

detectionAuditCleanupRoute.post('/cleanup', async (c) => {
  const userIdHeader = c.req.header('X-User-Id');
  if (!userIdHeader) {
    return c.json({ error: 'X-User-Id header is required for audit cleanup operations' }, 400);
  }

  const body = cleanupBodySchema.parse(await c.req.json().catch(() => ({})));

  // Auth rules:
  //  - channelId provided → channel-admin check against that channel
  //  - channelId omitted  → caller must be a global admin (env-gated)
  if (body.channelId) {
    const adminCheck = await requireChannelAdmin(body.channelId, userIdHeader);
    if (!adminCheck.ok) {
      return c.json({ error: adminCheck.message }, adminCheck.status);
    }
  } else {
    if (!isGlobalAdmin(userIdHeader)) {
      return c.json(
        {
          error: `user ${userIdHeader} is not a global admin — set GLOBAL_ADMIN_USER_IDS in the api env to enable all-channels cleanup, or pass a specific channelId in the request body`,
        },
        403,
      );
    }
  }

  try {
    const report = await cleanupAuditEvents(body.channelId);
    logger.info('admin-triggered audit cleanup completed', {
      scope: body.channelId ?? 'all-channels',
      totalDeleted: report.totalDeleted,
      durationMs: report.durationMs,
    });
    return c.json({ data: report });
  } catch (error) {
    logger.error('admin-triggered audit cleanup failed (error not swallowed per FR-017)', {
      scope: body.channelId ?? 'all-channels',
      ...errorDetails(error),
    });
    throw error;
  }
});
