import { beforeEach, describe, expect, mock, test } from 'bun:test';

/**
 * T064 — detection-overrides CRUD route tests.
 *
 * Covers the full lifecycle of the per-channel detection_overrides endpoints
 * against a mocked Drizzle db that returns deterministic rows. The shape of
 * the mock is intentionally small — each test controls `mockSelectRows`,
 * `mockInsertRows`, `mockUpdateRows`, `mockDeleteRows`, and
 * `mockChannelAdmins` to drive the code under test down each branch.
 *
 * Spec anchors: FR-033, FR-018, tasks.md T064, contracts/detection-overrides.http.
 */

const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';
const OVERRIDE_ID = 'aaaa1111-bbbb-2222-cccc-333333333333';
const ADMIN_USER = 'U_ADMIN';
const NON_ADMIN_USER = 'U_STRANGER';

const MOCK_OVERRIDE = {
  id: OVERRIDE_ID,
  channelId: CHANNEL_ID,
  overrideKind: 'allowlist_signature',
  targetKey: 'corpus_v1_sig_042',
  justification: 'false positive in security team workflow, see ticket #123',
  createdBy: ADMIN_USER,
  createdAt: new Date('2026-04-10T00:00:00.000Z'),
  updatedAt: new Date('2026-04-10T00:00:00.000Z'),
};

// The route uses two distinct select() shapes that we need to distinguish:
//   1. `.select({ channelAdmins: ... })` — the `requireChannelAdmin` lookup
//      in write handlers. Recognised by having a non-undefined argument.
//   2. `.select()` (no args) — the GET-path overrides list query.
//
// We route based on the presence of an argument to `select()`, which is
// state-free and robust across tests (unlike a call-counter that would
// leak between tests).
let mockChannelAdmins: string[] | null = [ADMIN_USER];
let mockSelectRows: unknown[] = [];
let mockInsertRows: unknown[] = [];
let mockUpdateRows: unknown[] = [];
let mockDeleteRows: unknown[] = [];
let mockInsertError: Error | null = null;
let invalidateConfigCalls: string[] = [];

function chainable(getRows: () => unknown[]): unknown {
  const methods: Record<string, unknown> = {};
  for (const name of ['from', 'where', 'orderBy', 'limit', 'groupBy', 'returning']) {
    methods[name] = () => chainable(getRows);
  }
  return Object.assign([...getRows()], methods);
}

mock.module('../../db', () => ({
  getDb: () => ({
    select: (columns?: unknown) => {
      if (columns !== undefined) {
        // `.select({ channelAdmins: ... })` — admin check in write handlers.
        // Returns [{channelAdmins: ...}] or [] when the channel is not found.
        return chainable(() =>
          mockChannelAdmins === null ? [] : [{ channelAdmins: mockChannelAdmins }],
        );
      }
      // `.select()` with no args — GET overrides list.
      return chainable(() => mockSelectRows);
    },
    insert: () => ({
      values: () => ({
        returning: () => {
          if (mockInsertError) throw mockInsertError;
          return [...mockInsertRows];
        },
      }),
    }),
    update: () => ({
      set: () => chainable(() => mockUpdateRows),
    }),
    delete: () => chainable(() => mockDeleteRows),
  }),
}));

mock.module('../../channels/config-cache', () => ({
  invalidateConfig: (channelId: string) => {
    invalidateConfigCalls.push(channelId);
  },
}));

import { Hono } from 'hono';
import { errorHandler } from '../../errors/error-handler';
import { detectionOverridesRoute } from '../detection-overrides';

function createApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/api/channels', detectionOverridesRoute);
  return app;
}

function jsonReq(path: string, options: RequestInit = {}) {
  return new Request(`http://localhost${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers as Record<string, string>) },
    ...options,
  });
}

function writeHeaders(userId: string = ADMIN_USER): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-User-Id': userId };
}

describe('T064 — detection-overrides CRUD route', () => {
  let app: Hono;

  beforeEach(() => {
    app = createApp();
    mockChannelAdmins = [ADMIN_USER];
    mockSelectRows = [];
    mockInsertRows = [];
    mockUpdateRows = [];
    mockDeleteRows = [];
    mockInsertError = null;
    invalidateConfigCalls = [];
  });

  // -----------------------------------------------------------------
  // GET — list overrides for a channel (read-only; no admin check)
  // -----------------------------------------------------------------

  test('GET /:channelId/detection-overrides returns all rows for the channel', async () => {
    mockSelectRows = [MOCK_OVERRIDE, { ...MOCK_OVERRIDE, id: 'other-id' }];
    const res = await app.request(`/api/channels/${CHANNEL_ID}/detection-overrides`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.overrides).toHaveLength(2);
  });

  test('GET returns empty array when no overrides exist', async () => {
    mockSelectRows = [];
    const res = await app.request(`/api/channels/${CHANNEL_ID}/detection-overrides`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.overrides).toEqual([]);
  });

  // -----------------------------------------------------------------
  // POST — admin check + create
  // -----------------------------------------------------------------

  test('POST without X-User-Id header returns 400', async () => {
    const res = await app.request(
      jsonReq(`/api/channels/${CHANNEL_ID}/detection-overrides`, {
        method: 'POST',
        body: JSON.stringify({
          overrideKind: 'allowlist_signature',
          targetKey: 'corpus_v1_sig_042',
          justification: 'test justification that is long enough',
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('X-User-Id');
  });

  test('POST returns 404 when the target channel does not exist', async () => {
    mockChannelAdmins = null; // channel not found
    const res = await app.request(
      jsonReq(`/api/channels/${CHANNEL_ID}/detection-overrides`, {
        method: 'POST',
        headers: writeHeaders(),
        body: JSON.stringify({
          overrideKind: 'allowlist_signature',
          targetKey: 'corpus_v1_sig_042',
          justification: 'test justification that is long enough',
        }),
      }),
    );
    expect(res.status).toBe(404);
  });

  test('POST returns 403 when the caller is not a channel admin', async () => {
    mockChannelAdmins = [ADMIN_USER]; // ADMIN_USER is an admin; NON_ADMIN_USER is not
    const res = await app.request(
      jsonReq(`/api/channels/${CHANNEL_ID}/detection-overrides`, {
        method: 'POST',
        headers: writeHeaders(NON_ADMIN_USER),
        body: JSON.stringify({
          overrideKind: 'allowlist_signature',
          targetKey: 'corpus_v1_sig_042',
          justification: 'test justification that is long enough',
        }),
      }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('not a channel admin');
    expect(invalidateConfigCalls).toEqual([]);
  });

  test('POST creates allowlist_signature override (happy path, invalidates cache)', async () => {
    mockInsertRows = [MOCK_OVERRIDE];
    const res = await app.request(
      jsonReq(`/api/channels/${CHANNEL_ID}/detection-overrides`, {
        method: 'POST',
        headers: writeHeaders(),
        body: JSON.stringify({
          overrideKind: 'allowlist_signature',
          targetKey: 'corpus_v1_sig_042',
          justification: 'false positive in security team workflow, see ticket #123',
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.overrideKind).toBe('allowlist_signature');
    expect(body.data.targetKey).toBe('corpus_v1_sig_042');
    expect(invalidateConfigCalls).toEqual([CHANNEL_ID]);
  });

  test('POST creates block_phrase override', async () => {
    mockInsertRows = [{ ...MOCK_OVERRIDE, overrideKind: 'block_phrase', targetKey: 'alpha_bravo' }];
    const res = await app.request(
      jsonReq(`/api/channels/${CHANNEL_ID}/detection-overrides`, {
        method: 'POST',
        headers: writeHeaders(),
        body: JSON.stringify({
          overrideKind: 'block_phrase',
          targetKey: 'alpha_bravo',
          justification: 'internal codename — leaking this is a policy violation',
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.overrideKind).toBe('block_phrase');
  });

  test('POST creates trust_mcp_tool override', async () => {
    mockInsertRows = [
      { ...MOCK_OVERRIDE, overrideKind: 'trust_mcp_tool', targetKey: 'internal_db_read' },
    ];
    const res = await app.request(
      jsonReq(`/api/channels/${CHANNEL_ID}/detection-overrides`, {
        method: 'POST',
        headers: writeHeaders(),
        body: JSON.stringify({
          overrideKind: 'trust_mcp_tool',
          targetKey: 'internal_db_read',
          justification: 'internal MCP returns only structured rows, no user text',
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.overrideKind).toBe('trust_mcp_tool');
  });

  test('POST rejects invalid overrideKind with 400', async () => {
    const res = await app.request(
      jsonReq(`/api/channels/${CHANNEL_ID}/detection-overrides`, {
        method: 'POST',
        headers: writeHeaders(),
        body: JSON.stringify({
          overrideKind: 'bogus_kind',
          targetKey: 'corpus_v1_sig_042',
          justification: 'test justification that is long enough',
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test('POST rejects short targetKey (< 3 chars) with 400', async () => {
    const res = await app.request(
      jsonReq(`/api/channels/${CHANNEL_ID}/detection-overrides`, {
        method: 'POST',
        headers: writeHeaders(),
        body: JSON.stringify({
          overrideKind: 'block_phrase',
          targetKey: 'ab',
          justification: 'test justification that is long enough',
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test('POST rejects short justification (< 10 chars) with 400', async () => {
    const res = await app.request(
      jsonReq(`/api/channels/${CHANNEL_ID}/detection-overrides`, {
        method: 'POST',
        headers: writeHeaders(),
        body: JSON.stringify({
          overrideKind: 'block_phrase',
          targetKey: 'alpha_bravo',
          justification: 'short',
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test('POST returns 409 on unique constraint violation (duplicate override)', async () => {
    const pgUniqueError = new Error('duplicate key value violates unique constraint') as Error & {
      code: string;
    };
    pgUniqueError.code = '23505';
    mockInsertError = pgUniqueError;

    const res = await app.request(
      jsonReq(`/api/channels/${CHANNEL_ID}/detection-overrides`, {
        method: 'POST',
        headers: writeHeaders(),
        body: JSON.stringify({
          overrideKind: 'allowlist_signature',
          targetKey: 'corpus_v1_sig_042',
          justification: 'first time adding this',
        }),
      }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('DUPLICATE_OVERRIDE');
    expect(invalidateConfigCalls).toEqual([]);
  });

  // -----------------------------------------------------------------
  // PATCH — justification-only edits
  // -----------------------------------------------------------------

  test('PATCH updates justification and invalidates cache', async () => {
    mockUpdateRows = [
      { ...MOCK_OVERRIDE, justification: 'updated rationale after further review' },
    ];
    const res = await app.request(
      jsonReq(`/api/channels/${CHANNEL_ID}/detection-overrides/${OVERRIDE_ID}`, {
        method: 'PATCH',
        headers: writeHeaders(),
        body: JSON.stringify({
          justification: 'updated rationale after further review',
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.justification).toBe('updated rationale after further review');
    expect(invalidateConfigCalls).toEqual([CHANNEL_ID]);
  });

  test('PATCH rejects attempts to change targetKey or overrideKind (schema strips unknown fields, validates justification)', async () => {
    // The Zod schema only accepts justification. Unknown fields are stripped
    // by default; the test verifies that if the body has no justification,
    // validation fails.
    const res = await app.request(
      jsonReq(`/api/channels/${CHANNEL_ID}/detection-overrides/${OVERRIDE_ID}`, {
        method: 'PATCH',
        headers: writeHeaders(),
        body: JSON.stringify({
          targetKey: 'corpus_v1_sig_999', // ignored
          overrideKind: 'trust_mcp_tool', // ignored
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test('PATCH returns 404 when override id does not exist', async () => {
    mockUpdateRows = [];
    const res = await app.request(
      jsonReq(`/api/channels/${CHANNEL_ID}/detection-overrides/${OVERRIDE_ID}`, {
        method: 'PATCH',
        headers: writeHeaders(),
        body: JSON.stringify({
          justification: 'updated rationale that is long enough',
        }),
      }),
    );
    expect(res.status).toBe(404);
    expect(invalidateConfigCalls).toEqual([]);
  });

  test('PATCH returns 403 for non-admin caller', async () => {
    const res = await app.request(
      jsonReq(`/api/channels/${CHANNEL_ID}/detection-overrides/${OVERRIDE_ID}`, {
        method: 'PATCH',
        headers: writeHeaders(NON_ADMIN_USER),
        body: JSON.stringify({ justification: 'updated rationale that is long enough' }),
      }),
    );
    expect(res.status).toBe(403);
  });

  // -----------------------------------------------------------------
  // DELETE — removes row, returns 204
  // -----------------------------------------------------------------

  test('DELETE returns 204 and invalidates cache on success', async () => {
    mockDeleteRows = [MOCK_OVERRIDE];
    const res = await app.request(
      jsonReq(`/api/channels/${CHANNEL_ID}/detection-overrides/${OVERRIDE_ID}`, {
        method: 'DELETE',
        headers: writeHeaders(),
      }),
    );
    expect(res.status).toBe(204);
    expect(invalidateConfigCalls).toEqual([CHANNEL_ID]);
  });

  test('DELETE returns 404 when override id does not exist', async () => {
    mockDeleteRows = [];
    const res = await app.request(
      jsonReq(`/api/channels/${CHANNEL_ID}/detection-overrides/${OVERRIDE_ID}`, {
        method: 'DELETE',
        headers: writeHeaders(),
      }),
    );
    expect(res.status).toBe(404);
    expect(invalidateConfigCalls).toEqual([]);
  });

  test('DELETE returns 403 for non-admin caller', async () => {
    const res = await app.request(
      jsonReq(`/api/channels/${CHANNEL_ID}/detection-overrides/${OVERRIDE_ID}`, {
        method: 'DELETE',
        headers: writeHeaders(NON_ADMIN_USER),
      }),
    );
    expect(res.status).toBe(403);
  });

  test('DELETE returns 400 without X-User-Id header', async () => {
    const res = await app.request(
      jsonReq(`/api/channels/${CHANNEL_ID}/detection-overrides/${OVERRIDE_ID}`, {
        method: 'DELETE',
      }),
    );
    expect(res.status).toBe(400);
  });
});
