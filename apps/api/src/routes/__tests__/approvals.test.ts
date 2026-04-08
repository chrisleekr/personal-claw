import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';
const MOCK_POLICY = {
  id: 'ap-001',
  channelId: CHANNEL_ID,
  toolName: 'deploy_production',
  policy: 'ask',
  allowedUsers: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

let mockRows: unknown[] = [];
let mockInsertRows: unknown[] = [];
let mockUpdateRows: unknown[] = [];
let mockDeleteRows: unknown[] = [];

function chainable(getRows: () => unknown[]): unknown {
  const methods: Record<string, unknown> = {};
  for (const name of ['from', 'where', 'orderBy', 'limit', 'groupBy', 'returning']) {
    methods[name] = () => chainable(getRows);
  }
  return Object.assign([...getRows()], methods);
}

mock.module('../../db', () => ({
  getDb: () => ({
    select: () => chainable(() => mockRows),
    insert: () => ({ values: () => ({ returning: () => [...mockInsertRows] }) }),
    update: () => ({ set: () => chainable(() => mockUpdateRows) }),
    delete: () => chainable(() => mockDeleteRows),
  }),
}));
mock.module('../../channels/config-cache', () => ({
  invalidateConfig: () => {},
  getCachedConfig: async () => null,
}));
mock.module('../../redis', () => ({ isRedisAvailable: () => false, getRedis: () => null }));
mock.module('../../config/hot-reload', () => ({ emitConfigChange: () => {} }));
mock.module('../../agent/cost-tracker', () => ({
  CostTracker: class {
    async getTodaySpend() {
      return 0;
    }
  },
}));

import { Hono } from 'hono';
import { errorHandler } from '../../errors/error-handler';
import { approvalsRoute } from '../approvals';

function createApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/api/approvals', approvalsRoute);
  return app;
}

function jsonReq(path: string, options: RequestInit = {}) {
  return new Request(`http://localhost${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers as Record<string, string>) },
    ...options,
  });
}

describe('Approvals Routes', () => {
  let app: Hono;

  beforeEach(() => {
    app = createApp();
    mockRows = [];
    mockInsertRows = [];
    mockUpdateRows = [];
    mockDeleteRows = [];
  });

  afterEach(() => {
    mockRows = [];
    mockInsertRows = [];
    mockUpdateRows = [];
    mockDeleteRows = [];
  });

  test('GET /:channelId returns policies', async () => {
    mockRows = [MOCK_POLICY];
    const res = await app.request(`/api/approvals/${CHANNEL_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].toolName).toBe('deploy_production');
  });

  test('POST / creates policy with valid input', async () => {
    mockInsertRows = [MOCK_POLICY];
    const res = await app.request(
      jsonReq('/api/approvals', {
        method: 'POST',
        body: JSON.stringify({ channelId: CHANNEL_ID, toolName: 'deploy_production' }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.toolName).toBe('deploy_production');
  });

  test('POST / returns 400 for missing toolName', async () => {
    const res = await app.request(
      jsonReq('/api/approvals', {
        method: 'POST',
        body: JSON.stringify({ channelId: CHANNEL_ID }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VALIDATION_ERROR');
  });

  test('PUT /:channelId/:id updates policy', async () => {
    mockRows = [MOCK_POLICY];
    mockUpdateRows = [{ ...MOCK_POLICY, policy: 'deny' }];
    const res = await app.request(
      jsonReq(`/api/approvals/${CHANNEL_ID}/ap-001`, {
        method: 'PUT',
        body: JSON.stringify({ policy: 'deny' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.policy).toBe('deny');
  });

  test('PUT /:channelId/:id returns 404 when not found', async () => {
    mockUpdateRows = [];
    const res = await app.request(
      jsonReq(`/api/approvals/${CHANNEL_ID}/nonexistent`, {
        method: 'PUT',
        body: JSON.stringify({ policy: 'auto' }),
      }),
    );
    expect(res.status).toBe(404);
  });

  test('DELETE /:channelId/:id deletes policy', async () => {
    mockRows = [MOCK_POLICY];
    mockDeleteRows = [MOCK_POLICY];
    const res = await app.request(`/api/approvals/${CHANNEL_ID}/ap-001`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deleted).toBe(true);
  });

  test('DELETE /:channelId/:id returns 404 when not found', async () => {
    mockDeleteRows = [];
    const res = await app.request(`/api/approvals/${CHANNEL_ID}/nonexistent`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});
