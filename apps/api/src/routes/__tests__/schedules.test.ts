import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';
const MOCK_SCHEDULE = {
  id: 'sched-001',
  channelId: CHANNEL_ID,
  name: 'Daily standup',
  cronExpression: '0 9 * * *',
  prompt: 'Summarize yesterday',
  enabled: true,
  notifyUsers: [],
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
import { schedulesRoute } from '../schedules';

function createApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/api/schedules', schedulesRoute);
  return app;
}

function jsonReq(path: string, options: RequestInit = {}) {
  return new Request(`http://localhost${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers as Record<string, string>) },
    ...options,
  });
}

describe('Schedules Routes', () => {
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

  test('GET /:channelId returns schedules', async () => {
    mockRows = [MOCK_SCHEDULE];
    const res = await app.request(`/api/schedules/${CHANNEL_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe('Daily standup');
  });

  test('POST / creates schedule with valid input', async () => {
    mockInsertRows = [MOCK_SCHEDULE];
    const res = await app.request(
      jsonReq('/api/schedules', {
        method: 'POST',
        body: JSON.stringify({
          channelId: CHANNEL_ID,
          name: 'Daily standup',
          cronExpression: '0 9 * * *',
          prompt: 'Summarize yesterday',
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.name).toBe('Daily standup');
  });

  test('POST / returns 400 for missing required fields', async () => {
    const res = await app.request(
      jsonReq('/api/schedules', {
        method: 'POST',
        body: JSON.stringify({ channelId: CHANNEL_ID }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VALIDATION_ERROR');
  });

  test('PUT /:id updates schedule', async () => {
    mockUpdateRows = [{ ...MOCK_SCHEDULE, name: 'Weekly review' }];
    const res = await app.request(
      jsonReq('/api/schedules/sched-001', {
        method: 'PUT',
        body: JSON.stringify({ name: 'Weekly review' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.name).toBe('Weekly review');
  });

  test('PUT /:id returns 404 when not found', async () => {
    mockUpdateRows = [];
    const res = await app.request(
      jsonReq('/api/schedules/nonexistent', {
        method: 'PUT',
        body: JSON.stringify({ name: 'test' }),
      }),
    );
    expect(res.status).toBe(404);
  });

  test('DELETE /:id deletes schedule', async () => {
    mockDeleteRows = [MOCK_SCHEDULE];
    const res = await app.request('/api/schedules/sched-001', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deleted).toBe(true);
  });

  test('DELETE /:id returns 404 when not found', async () => {
    mockDeleteRows = [];
    const res = await app.request('/api/schedules/nonexistent', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});
