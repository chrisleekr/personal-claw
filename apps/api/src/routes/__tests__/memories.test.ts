import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';
const MOCK_MEMORY = {
  id: 'mem-001',
  channelId: CHANNEL_ID,
  content: 'The deploy key rotates every 90 days',
  category: 'fact',
  recallCount: 3,
  createdAt: new Date(),
  updatedAt: new Date(),
};

let mockRows: unknown[] = [];
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
    insert: () => ({ values: () => ({ returning: () => [] }) }),
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
import { memoriesRoute } from '../memories';

function createApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/api/memories', memoriesRoute);
  return app;
}

function jsonReq(path: string, options: RequestInit = {}) {
  return new Request(`http://localhost${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers as Record<string, string>) },
    ...options,
  });
}

describe('Memories Routes', () => {
  let app: Hono;

  beforeEach(() => {
    app = createApp();
    mockRows = [];
    mockUpdateRows = [];
    mockDeleteRows = [];
  });

  afterEach(() => {
    mockRows = [];
    mockUpdateRows = [];
    mockDeleteRows = [];
  });

  test('GET /:channelId returns memories', async () => {
    mockRows = [MOCK_MEMORY];
    const res = await app.request(`/api/memories/${CHANNEL_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].content).toBe('The deploy key rotates every 90 days');
  });

  test('GET /:channelId returns empty list', async () => {
    mockRows = [];
    const res = await app.request(`/api/memories/${CHANNEL_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(0);
  });

  test('GET /:channelId/search returns filtered memories', async () => {
    mockRows = [MOCK_MEMORY];
    const res = await app.request(`/api/memories/${CHANNEL_ID}/search?q=deploy`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
  });

  test('GET /:channelId/search without query returns all', async () => {
    mockRows = [MOCK_MEMORY];
    const res = await app.request(`/api/memories/${CHANNEL_ID}/search`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
  });

  test('PATCH /:channelId/:id updates memory', async () => {
    mockRows = [MOCK_MEMORY];
    mockUpdateRows = [{ ...MOCK_MEMORY, content: 'Updated content' }];
    const res = await app.request(
      jsonReq(`/api/memories/${CHANNEL_ID}/mem-001`, {
        method: 'PATCH',
        body: JSON.stringify({ content: 'Updated content' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.content).toBe('Updated content');
  });

  test('PATCH /:channelId/:id returns 404 when not found', async () => {
    mockUpdateRows = [];
    const res = await app.request(
      jsonReq(`/api/memories/${CHANNEL_ID}/nonexistent`, {
        method: 'PATCH',
        body: JSON.stringify({ content: 'test' }),
      }),
    );
    expect(res.status).toBe(404);
  });

  test('PATCH /:channelId/:id returns 400 for invalid input', async () => {
    const res = await app.request(
      jsonReq(`/api/memories/${CHANNEL_ID}/mem-001`, {
        method: 'PATCH',
        body: JSON.stringify({ content: '' }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VALIDATION_ERROR');
  });

  test('DELETE /:channelId/:id deletes memory', async () => {
    mockRows = [MOCK_MEMORY];
    mockDeleteRows = [MOCK_MEMORY];
    const res = await app.request(`/api/memories/${CHANNEL_ID}/mem-001`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deleted).toBe(true);
  });

  test('DELETE /:channelId/:id returns 404 when not found', async () => {
    mockDeleteRows = [];
    const res = await app.request(`/api/memories/${CHANNEL_ID}/nonexistent`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});
