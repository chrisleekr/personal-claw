import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';

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
import { skillStatsRoute } from '../skill-stats';

function createApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/api/skill-stats', skillStatsRoute);
  return app;
}

describe('Skill Stats Routes', () => {
  let app: Hono;

  beforeEach(() => {
    app = createApp();
    mockRows = [];
  });

  afterEach(() => {
    mockRows = [];
  });

  test('GET /:channelId/stats returns stats', async () => {
    mockRows = [{ skillId: 'skill-1', loadCount: 5, name: 'Deploy' }];
    const res = await app.request(`/api/skill-stats/${CHANNEL_ID}/stats`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
  });

  test('GET /:channelId/stats returns empty for no data', async () => {
    mockRows = [];
    const res = await app.request(`/api/skill-stats/${CHANNEL_ID}/stats`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
  });
});
