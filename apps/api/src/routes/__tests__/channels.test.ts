import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';
const MOCK_CHANNEL = {
  id: CHANNEL_ID,
  platform: 'slack',
  externalId: 'C0123456789',
  externalName: '#general',
  model: 'claude-sonnet-4-20250514',
  provider: 'anthropic',
  maxIterations: 25,
  heartbeatEnabled: false,
  heartbeatPrompt: null,
  identityPrompt: null,
  teamPrompt: null,
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
import { channelsRoute } from '../channels';

function createApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/api/channels', channelsRoute);
  return app;
}

function jsonReq(path: string, options: RequestInit = {}) {
  return new Request(`http://localhost${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers as Record<string, string>) },
    ...options,
  });
}

describe('Channels Routes', () => {
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

  test('GET / returns channel list', async () => {
    mockRows = [MOCK_CHANNEL];
    const res = await app.request('/api/channels');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].externalId).toBe('C0123456789');
  });

  test('GET / returns empty list', async () => {
    mockRows = [];
    const res = await app.request('/api/channels');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(0);
  });

  test('GET /:id returns single channel', async () => {
    mockRows = [MOCK_CHANNEL];
    const res = await app.request(`/api/channels/${CHANNEL_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.platform).toBe('slack');
  });

  test('GET /:id returns 404 when not found', async () => {
    mockRows = [];
    const res = await app.request('/api/channels/nonexistent');
    expect(res.status).toBe(404);
  });

  test('POST / creates channel with valid input', async () => {
    mockInsertRows = [MOCK_CHANNEL];
    const res = await app.request(
      jsonReq('/api/channels', {
        method: 'POST',
        body: JSON.stringify({ externalId: 'C0123456789', platform: 'slack' }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.externalId).toBe('C0123456789');
  });

  test('POST / returns 400 for missing externalId', async () => {
    const res = await app.request(
      jsonReq('/api/channels', {
        method: 'POST',
        body: JSON.stringify({ platform: 'slack' }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VALIDATION_ERROR');
  });

  test('PUT /:id updates channel', async () => {
    mockUpdateRows = [{ ...MOCK_CHANNEL, externalName: '#random' }];
    const res = await app.request(
      jsonReq(`/api/channels/${CHANNEL_ID}`, {
        method: 'PUT',
        body: JSON.stringify({ externalName: '#random' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.externalName).toBe('#random');
  });

  test('PUT /:id returns 404 when not found', async () => {
    mockUpdateRows = [];
    const res = await app.request(
      jsonReq('/api/channels/nonexistent', {
        method: 'PUT',
        body: JSON.stringify({ externalName: 'test' }),
      }),
    );
    expect(res.status).toBe(404);
  });

  test('DELETE /:id deletes channel', async () => {
    mockDeleteRows = [MOCK_CHANNEL];
    const res = await app.request(`/api/channels/${CHANNEL_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deleted).toBe(true);
  });

  test('DELETE /:id returns 404 when not found', async () => {
    mockDeleteRows = [];
    const res = await app.request('/api/channels/nonexistent', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});
