import { getLogger } from '@logtape/logtape';
import { and, channels, detectionOverrides, eq } from '@personalclaw/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { invalidateConfig } from '../channels/config-cache';
import { getDb } from '../db';
import { errorDetails } from '../utils/error-fmt';

/**
 * FR-033 — Per-channel detection override CRUD.
 *
 * This route file is deliberately split from `detection-audit.ts` per
 * analysis finding D1 so Phase 4 (this work) and Phase 5 (audit endpoints)
 * edit different files and can merge independently.
 *
 * Paths (mounted at `/api/channels` in `apps/api/src/index.ts` so the final
 * URLs are `/api/channels/:channelId/detection-overrides[/:id]`):
 *
 *   GET    /:channelId/detection-overrides
 *   POST   /:channelId/detection-overrides
 *   PATCH  /:channelId/detection-overrides/:id
 *   DELETE /:channelId/detection-overrides/:id
 *
 * Auth model:
 *
 *   - The bearer token (`API_SECRET`) is enforced by the app-level middleware
 *     before the request reaches this handler — that gate alone is sufficient
 *     for read operations (GET).
 *   - Write operations (POST / PATCH / DELETE) additionally require an
 *     `X-User-Id` header identifying the calling user. The handler then
 *     verifies that user id is in `channels.channelAdmins` for the target
 *     channel, returning 400 if the header is missing, 403 if the user is
 *     not an admin, and 404 if the channel itself does not exist.
 *   - The verified user id is also recorded in `detection_overrides.created_by`
 *     so the audit trail captures provenance.
 *
 * Config cache invalidation: every successful write calls
 * `invalidateConfig(channelId)` so the next `DetectionEngine.detect()` call
 * for that channel picks up the new override set within one cache refresh
 * cycle (FR-018).
 *
 * Spec anchors: FR-018, FR-033, tasks.md T068, contracts/detection-overrides.http.
 */

const logger = getLogger(['personalclaw', 'routes', 'detection-overrides']);

/** Postgres unique-violation SQLSTATE. */
const PG_UNIQUE_VIOLATION = '23505';

export const OVERRIDE_KINDS = ['allowlist_signature', 'block_phrase', 'trust_mcp_tool'] as const;
export type OverrideKind = (typeof OVERRIDE_KINDS)[number];

/**
 * Zod schema for the POST body. `justification` has a min length of 10 so
 * the audit trail records a real reason rather than a placeholder.
 */
export const createOverrideSchema = z.object({
  overrideKind: z.enum(OVERRIDE_KINDS),
  targetKey: z.string().min(3).max(500),
  justification: z.string().min(10).max(2000),
});

/**
 * Zod schema for the PATCH body. Only `justification` is editable —
 * changing `overrideKind` or `targetKey` requires delete + insert because
 * those two fields participate in the unique constraint alongside
 * `channel_id`.
 */
export const updateOverrideSchema = z.object({
  justification: z.string().min(10).max(2000),
});

interface AdminCheckFailure {
  ok: false;
  status: 400 | 403 | 404;
  message: string;
}

interface AdminCheckSuccess {
  ok: true;
  userId: string;
}

/**
 * Verifies the calling user is listed in `channels.channelAdmins` for the
 * given channel. Returns a tagged result the caller can turn into an error
 * response. Does NOT auto-assign the first user as admin like the Slack
 * slash command path does — REST writes require an existing admin to seed
 * the list (usually via the slash command first, or a manual SQL insert).
 */
async function requireChannelAdmin(
  channelId: string,
  userIdHeader: string | undefined,
): Promise<AdminCheckSuccess | AdminCheckFailure> {
  if (!userIdHeader) {
    return {
      ok: false,
      status: 400,
      message:
        'X-User-Id header is required on write operations — it identifies which channel admin is making the change and is recorded in detection_overrides.created_by',
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

export const detectionOverridesRoute = new Hono();

/**
 * GET /:channelId/detection-overrides — list all overrides for the channel.
 * Read-only: bearer token is the only auth requirement.
 */
detectionOverridesRoute.get('/:channelId/detection-overrides', async (c) => {
  const channelId = c.req.param('channelId');
  const db = getDb();
  const rows = await db
    .select()
    .from(detectionOverrides)
    .where(eq(detectionOverrides.channelId, channelId))
    .orderBy(detectionOverrides.createdAt);
  return c.json({ data: { overrides: rows } });
});

/**
 * POST /:channelId/detection-overrides — create a new override for the
 * channel. Requires X-User-Id header + channelAdmins membership.
 * Returns 201 on success, 400 on validation failure, 403 on non-admin,
 * 404 on missing channel, 409 on unique-constraint violation (duplicate).
 */
detectionOverridesRoute.post('/:channelId/detection-overrides', async (c) => {
  const channelId = c.req.param('channelId');
  const userIdHeader = c.req.header('X-User-Id');

  const adminCheck = await requireChannelAdmin(channelId, userIdHeader);
  if (!adminCheck.ok) {
    return c.json({ error: adminCheck.message }, adminCheck.status);
  }

  const input = createOverrideSchema.parse(await c.req.json());

  try {
    const db = getDb();
    const [row] = await db
      .insert(detectionOverrides)
      .values({
        channelId,
        overrideKind: input.overrideKind,
        targetKey: input.targetKey,
        justification: input.justification,
        createdBy: adminCheck.userId,
      })
      .returning();
    invalidateConfig(channelId);
    logger.info('detection override created', {
      channelId,
      overrideKind: row.overrideKind,
      targetKey: row.targetKey,
      createdBy: row.createdBy,
    });
    return c.json({ data: row }, 201);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === PG_UNIQUE_VIOLATION) {
      return c.json(
        {
          error: 'DUPLICATE_OVERRIDE',
          message: `an override with the same (overrideKind, targetKey) already exists for channel ${channelId}`,
        },
        409,
      );
    }
    logger.warn('detection override insert failed', {
      channelId,
      overrideKind: input.overrideKind,
      ...errorDetails(error),
    });
    throw error;
  }
});

/**
 * PATCH /:channelId/detection-overrides/:id — update an existing override.
 * Only `justification` is editable; `overrideKind` and `targetKey` cannot
 * be changed (delete + insert instead, so the unique constraint is
 * re-checked and the audit trail is clean).
 */
detectionOverridesRoute.patch('/:channelId/detection-overrides/:id', async (c) => {
  const channelId = c.req.param('channelId');
  const id = c.req.param('id');
  const userIdHeader = c.req.header('X-User-Id');

  const adminCheck = await requireChannelAdmin(channelId, userIdHeader);
  if (!adminCheck.ok) {
    return c.json({ error: adminCheck.message }, adminCheck.status);
  }

  const input = updateOverrideSchema.parse(await c.req.json());

  const db = getDb();
  const [row] = await db
    .update(detectionOverrides)
    .set({ justification: input.justification, updatedAt: new Date() })
    .where(and(eq(detectionOverrides.id, id), eq(detectionOverrides.channelId, channelId)))
    .returning();

  if (!row) {
    return c.json({ error: `detection override ${id} not found for channel ${channelId}` }, 404);
  }

  invalidateConfig(channelId);
  logger.info('detection override updated', {
    channelId,
    id,
    updatedBy: adminCheck.userId,
  });
  return c.json({ data: row });
});

/**
 * DELETE /:channelId/detection-overrides/:id — delete an override. Returns
 * 204 on success (no body per the contract). `invalidateConfig` fires after
 * the delete so the next detect() call picks up the smaller override set.
 */
detectionOverridesRoute.delete('/:channelId/detection-overrides/:id', async (c) => {
  const channelId = c.req.param('channelId');
  const id = c.req.param('id');
  const userIdHeader = c.req.header('X-User-Id');

  const adminCheck = await requireChannelAdmin(channelId, userIdHeader);
  if (!adminCheck.ok) {
    return c.json({ error: adminCheck.message }, adminCheck.status);
  }

  const db = getDb();
  const [row] = await db
    .delete(detectionOverrides)
    .where(and(eq(detectionOverrides.id, id), eq(detectionOverrides.channelId, channelId)))
    .returning();

  if (!row) {
    return c.json({ error: `detection override ${id} not found for channel ${channelId}` }, 404);
  }

  invalidateConfig(channelId);
  logger.info('detection override deleted', {
    channelId,
    id,
    deletedBy: adminCheck.userId,
  });
  return c.body(null, 204);
});
