import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';
const MOCK_USAGE_ROW = {
  id: 'usage-001',
  channelId: CHANNEL_ID,
  model: 'claude-sonnet-4-20250514',
  promptTokens: 500,
  completionTokens: 200,
  totalTokens: 700,
  estimatedCostUsd: '0.0021',
  createdAt: new Date(),
};

let mockRows: unknown[] = [];

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
    update: () => ({ set: () => chainable(() => []) }),
    delete: () => chainable(() => []),
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
import { usageRoute } from '../usage';

function createApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/api/usage', usageRoute);
  return app;
}

describe('Usage Routes', () => {
  let app: Hono;

  beforeEach(() => {
    app = createApp();
    mockRows = [];
  });

  afterEach(() => {
    mockRows = [];
  });

  test('GET /pricing returns model pricing list', async () => {
    const res = await app.request('/api/usage/pricing');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]).toHaveProperty('model');
    expect(body.data[0]).toHaveProperty('pricing');
  });

  test('GET /:channelId returns usage data', async () => {
    mockRows = [MOCK_USAGE_ROW];
    const res = await app.request(`/api/usage/${CHANNEL_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveProperty('usage');
    expect(body.data).toHaveProperty('totalTokens');
    expect(body.data).toHaveProperty('totalCost');
  });

  test('GET /:channelId returns zero totals with no usage', async () => {
    mockRows = [{ totalTokens: null, totalCost: null }];
    const res = await app.request(`/api/usage/${CHANNEL_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.totalTokens).toBe(0);
    expect(body.data.totalCost).toBe(0);
  });

  test('GET /:channelId/budget returns budget status', async () => {
    mockRows = [{ costBudgetDailyUsd: '5.00' }];
    const res = await app.request(`/api/usage/${CHANNEL_ID}/budget`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveProperty('dailyBudget');
    expect(body.data).toHaveProperty('todaySpend');
    expect(body.data).toHaveProperty('percentUsed');
  });

  test('GET /:channelId/budget returns null budget when unconfigured', async () => {
    mockRows = [{ costBudgetDailyUsd: null }];
    const res = await app.request(`/api/usage/${CHANNEL_ID}/budget`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.dailyBudget).toBeNull();
    expect(body.data.percentUsed).toBeNull();
  });

  test('GET /:channelId/daily returns daily aggregates', async () => {
    mockRows = [{ date: '2026-03-01', totalTokens: '700', totalCost: '0.0021', request_count: 1 }];
    const res = await app.request(`/api/usage/${CHANNEL_ID}/daily`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('GET /:channelId/daily returns empty array', async () => {
    mockRows = [];
    const res = await app.request(`/api/usage/${CHANNEL_ID}/daily`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(0);
  });
});
