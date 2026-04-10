import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

/**
 * T073 — POST /api/guardrails/audit/cleanup route tests.
 *
 * Covers the admin-triggered cleanup endpoint in
 * `apps/api/src/routes/detection-audit.ts` which paraphrase-wraps the
 * shared `cleanupAuditEvents()` deletion function from the cron module.
 *
 * Auth rules under test:
 *   - channelId provided → requireChannelAdmin for that channel
 *   - channelId omitted  → caller must be in GLOBAL_ADMIN_USER_IDS env
 *
 * Spec anchors: FR-017, FR-028 (part b), tasks.md T073, T076,
 * contracts/detection-audit-cleanup.http.
 */

const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';
const ADMIN_USER = 'U_ADMIN';
const NON_ADMIN_USER = 'U_STRANGER';
const GLOBAL_ADMIN = 'U_GLOBAL_ADMIN';

let mockChannelAdmins: string[] | null = [ADMIN_USER];
let mockCleanupReport = { deletedByChannel: { [CHANNEL_ID]: 5 }, totalDeleted: 5, durationMs: 12 };
let mockCleanupError: Error | null = null;
let cleanupCalls: Array<string | undefined> = [];

function chainable(getRows: () => unknown[]): unknown {
  const methods: Record<string, unknown> = {};
  for (const name of ['from', 'where', 'orderBy', 'limit']) {
    methods[name] = () => chainable(getRows);
  }
  return Object.assign([...getRows()], methods);
}

// Only the admin check reads the db. The actual cleanup is handled by
// the mocked cron helper.
mock.module('../../db', () => ({
  getDb: () => ({
    select: () =>
      chainable(() => (mockChannelAdmins === null ? [] : [{ channelAdmins: mockChannelAdmins }])),
  }),
}));

mock.module('../../cron/audit-cleanup', () => ({
  cleanupAuditEvents: async (channelId?: string) => {
    cleanupCalls.push(channelId);
    if (mockCleanupError) throw mockCleanupError;
    return mockCleanupReport;
  },
}));

import { Hono } from 'hono';
import { errorHandler } from '../../errors/error-handler';
import { detectionAuditCleanupRoute } from '../detection-audit';

function createApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/api/guardrails/audit', detectionAuditCleanupRoute);
  return app;
}

function jsonBody(body: unknown, userId?: string): RequestInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (userId) headers['X-User-Id'] = userId;
  return {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  };
}

describe('T073 — POST /api/guardrails/audit/cleanup', () => {
  let app: Hono;
  const originalGlobalAdmins = process.env.GLOBAL_ADMIN_USER_IDS;

  beforeEach(() => {
    app = createApp();
    mockChannelAdmins = [ADMIN_USER];
    mockCleanupReport = { deletedByChannel: { [CHANNEL_ID]: 5 }, totalDeleted: 5, durationMs: 12 };
    mockCleanupError = null;
    cleanupCalls = [];
  });

  afterEach(() => {
    if (originalGlobalAdmins === undefined) {
      delete process.env.GLOBAL_ADMIN_USER_IDS;
    } else {
      process.env.GLOBAL_ADMIN_USER_IDS = originalGlobalAdmins;
    }
  });

  test('requires X-User-Id header → 400', async () => {
    const res = await app.request(
      new Request(
        'http://localhost/api/guardrails/audit/cleanup',
        jsonBody({ channelId: CHANNEL_ID }),
      ),
    );
    expect(res.status).toBe(400);
  });

  test('channelId provided + caller is a channel admin → 200 with report', async () => {
    const res = await app.request(
      new Request(
        'http://localhost/api/guardrails/audit/cleanup',
        jsonBody({ channelId: CHANNEL_ID }, ADMIN_USER),
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.totalDeleted).toBe(5);
    expect(body.data.deletedByChannel[CHANNEL_ID]).toBe(5);
    expect(cleanupCalls).toEqual([CHANNEL_ID]);
  });

  test('channelId provided + caller is NOT a channel admin → 403', async () => {
    const res = await app.request(
      new Request(
        'http://localhost/api/guardrails/audit/cleanup',
        jsonBody({ channelId: CHANNEL_ID }, NON_ADMIN_USER),
      ),
    );
    expect(res.status).toBe(403);
    expect(cleanupCalls).toEqual([]);
  });

  test('channelId provided + channel does not exist → 404', async () => {
    mockChannelAdmins = null;
    const res = await app.request(
      new Request(
        'http://localhost/api/guardrails/audit/cleanup',
        jsonBody({ channelId: CHANNEL_ID }, ADMIN_USER),
      ),
    );
    expect(res.status).toBe(404);
    expect(cleanupCalls).toEqual([]);
  });

  test('channelId omitted + GLOBAL_ADMIN_USER_IDS unset → 403 (explicit deny)', async () => {
    delete process.env.GLOBAL_ADMIN_USER_IDS;
    const res = await app.request(
      new Request('http://localhost/api/guardrails/audit/cleanup', jsonBody({}, ADMIN_USER)),
    );
    expect(res.status).toBe(403);
    expect(cleanupCalls).toEqual([]);
  });

  test('channelId omitted + caller is in GLOBAL_ADMIN_USER_IDS → 200 all-channels sweep', async () => {
    process.env.GLOBAL_ADMIN_USER_IDS = `other-user,${GLOBAL_ADMIN},third-user`;
    mockCleanupReport = {
      deletedByChannel: { [CHANNEL_ID]: 10, 'other-ch': 7 },
      totalDeleted: 17,
      durationMs: 45,
    };
    const res = await app.request(
      new Request('http://localhost/api/guardrails/audit/cleanup', jsonBody({}, GLOBAL_ADMIN)),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.totalDeleted).toBe(17);
    expect(cleanupCalls).toEqual([undefined]); // undefined channelId = all-channels sweep
  });

  test('channelId omitted + caller NOT in GLOBAL_ADMIN_USER_IDS → 403', async () => {
    process.env.GLOBAL_ADMIN_USER_IDS = GLOBAL_ADMIN;
    const res = await app.request(
      new Request('http://localhost/api/guardrails/audit/cleanup', jsonBody({}, NON_ADMIN_USER)),
    );
    expect(res.status).toBe(403);
    expect(cleanupCalls).toEqual([]);
  });

  test('cleanupAuditEvents throws → 500 and error NOT swallowed (FR-017)', async () => {
    mockCleanupError = new Error('simulated db failure');
    const res = await app.request(
      new Request(
        'http://localhost/api/guardrails/audit/cleanup',
        jsonBody({ channelId: CHANNEL_ID }, ADMIN_USER),
      ),
    );
    expect(res.status).toBe(500);
    expect(cleanupCalls).toEqual([CHANNEL_ID]);
  });

  test('empty JSON body is accepted (all-channels sweep intent)', async () => {
    process.env.GLOBAL_ADMIN_USER_IDS = GLOBAL_ADMIN;
    const res = await app.request(
      new Request('http://localhost/api/guardrails/audit/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': GLOBAL_ADMIN },
        body: '',
      }),
    );
    expect(res.status).toBe(200);
  });
});
