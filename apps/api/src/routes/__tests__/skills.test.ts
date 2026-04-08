import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';
const MOCK_SKILL = {
  id: 'skill-001',
  channelId: CHANNEL_ID,
  name: 'deploy-prod',
  content: 'Run production deployment pipeline',
  allowedTools: ['run_bash'],
  enabled: true,
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
import { skillsRoute } from '../skills';

function createApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/api/skills', skillsRoute);
  return app;
}

function jsonReq(path: string, options: RequestInit = {}) {
  return new Request(`http://localhost${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers as Record<string, string>) },
    ...options,
  });
}

describe('Skills Routes', () => {
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

  test('GET /:channelId returns skills', async () => {
    mockRows = [MOCK_SKILL];
    const res = await app.request(`/api/skills/${CHANNEL_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe('deploy-prod');
  });

  test('GET /:channelId returns empty list', async () => {
    mockRows = [];
    const res = await app.request(`/api/skills/${CHANNEL_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(0);
  });

  test('POST / creates skill with valid input', async () => {
    mockInsertRows = [MOCK_SKILL];
    const res = await app.request(
      jsonReq('/api/skills', {
        method: 'POST',
        body: JSON.stringify({
          channelId: CHANNEL_ID,
          name: 'deploy-prod',
          content: 'Run production deployment pipeline',
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.name).toBe('deploy-prod');
  });

  test('POST / returns 400 for missing required fields', async () => {
    const res = await app.request(
      jsonReq('/api/skills', {
        method: 'POST',
        body: JSON.stringify({ channelId: CHANNEL_ID }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VALIDATION_ERROR');
  });

  test('POST / returns 400 for invalid channelId', async () => {
    const res = await app.request(
      jsonReq('/api/skills', {
        method: 'POST',
        body: JSON.stringify({ channelId: 'not-a-uuid', name: 'test', content: 'x' }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VALIDATION_ERROR');
  });

  test('PUT /:channelId/:id updates skill', async () => {
    mockRows = [MOCK_SKILL];
    mockUpdateRows = [{ ...MOCK_SKILL, name: 'deploy-staging' }];
    const res = await app.request(
      jsonReq(`/api/skills/${CHANNEL_ID}/skill-001`, {
        method: 'PUT',
        body: JSON.stringify({ name: 'deploy-staging' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.name).toBe('deploy-staging');
  });

  test('PUT /:channelId/:id returns 404 when not found', async () => {
    mockUpdateRows = [];
    const res = await app.request(
      jsonReq(`/api/skills/${CHANNEL_ID}/nonexistent`, {
        method: 'PUT',
        body: JSON.stringify({ name: 'test' }),
      }),
    );
    expect(res.status).toBe(404);
  });

  test('DELETE /:channelId/:id deletes skill', async () => {
    mockRows = [MOCK_SKILL];
    mockDeleteRows = [MOCK_SKILL];
    const res = await app.request(`/api/skills/${CHANNEL_ID}/skill-001`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deleted).toBe(true);
  });

  test('DELETE /:channelId/:id returns 404 when not found', async () => {
    mockDeleteRows = [];
    const res = await app.request(`/api/skills/${CHANNEL_ID}/nonexistent`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});
