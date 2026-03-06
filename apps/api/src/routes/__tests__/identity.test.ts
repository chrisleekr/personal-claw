import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';
const MOCK_IDENTITY = {
  identityPrompt: 'You are HelperBot.',
  teamPrompt: 'We use TypeScript.',
  threadReplyMode: 'all',
  autonomyLevel: 'balanced',
};

let mockRows: unknown[] = [];
let mockUpdateRows: unknown[] = [];

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
    update: () => ({ set: () => chainable(() => mockUpdateRows) }),
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
import { identityRoute } from '../identity';

function createApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/api/identity', identityRoute);
  return app;
}

function jsonReq(path: string, options: RequestInit = {}) {
  return new Request(`http://localhost${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers as Record<string, string>) },
    ...options,
  });
}

describe('Identity Routes', () => {
  let app: Hono;

  beforeEach(() => {
    app = createApp();
    mockRows = [];
    mockUpdateRows = [];
  });

  afterEach(() => {
    mockRows = [];
    mockUpdateRows = [];
  });

  test('GET /:channelId returns identity', async () => {
    mockRows = [MOCK_IDENTITY];
    const res = await app.request(`/api/identity/${CHANNEL_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.identityPrompt).toBe('You are HelperBot.');
  });

  test('GET /:channelId returns 404 when channel not found', async () => {
    mockRows = [];
    const res = await app.request('/api/identity/nonexistent');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('NOT_FOUND');
  });

  test('PUT /:channelId updates identity', async () => {
    mockUpdateRows = [{ ...MOCK_IDENTITY, identityPrompt: 'Updated.' }];
    const res = await app.request(
      jsonReq(`/api/identity/${CHANNEL_ID}`, {
        method: 'PUT',
        body: JSON.stringify({ identityPrompt: 'Updated.' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.identityPrompt).toBe('Updated.');
  });

  test('PUT /:channelId returns 400 for invalid autonomyLevel', async () => {
    const res = await app.request(
      jsonReq(`/api/identity/${CHANNEL_ID}`, {
        method: 'PUT',
        body: JSON.stringify({ autonomyLevel: 'reckless' }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VALIDATION_ERROR');
  });

  test('PUT /:channelId returns 404 when channel not found', async () => {
    mockUpdateRows = [];
    const res = await app.request(
      jsonReq('/api/identity/nonexistent', {
        method: 'PUT',
        body: JSON.stringify({ identityPrompt: 'test' }),
      }),
    );
    expect(res.status).toBe(404);
  });
});
