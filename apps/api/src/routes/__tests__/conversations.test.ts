import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';
const MOCK_CONVERSATION = {
  id: 'conv-001',
  channelId: CHANNEL_ID,
  externalThreadId: 'thread-123',
  messages: [{ role: 'user', content: 'Hello' }],
  summary: null,
  isCompacted: false,
  tokenCount: 10,
  createdAt: new Date(),
  updatedAt: new Date(),
};

let mockRows: unknown[] = [];

function chainable(getRows: () => unknown[]): unknown {
  const methods: Record<string, unknown> = {};
  for (const name of ['from', 'where', 'orderBy', 'limit', 'groupBy', 'returning', 'as']) {
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
mock.module('../../agent/provider', () => ({
  getProvider: async () => ({ provider: () => ({}), model: 'test-model' }),
}));

import { Hono } from 'hono';
import { errorHandler } from '../../errors/error-handler';
import { conversationsRoute } from '../conversations';

function createApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/api/conversations', conversationsRoute);
  return app;
}

describe('Conversations Routes', () => {
  let app: Hono;

  beforeEach(() => {
    app = createApp();
    mockRows = [];
  });

  afterEach(() => {
    mockRows = [];
  });

  test('GET /:channelId returns conversation list', async () => {
    mockRows = [MOCK_CONVERSATION];
    const res = await app.request(`/api/conversations/${CHANNEL_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
    expect(body.data).toHaveLength(1);
  });

  test('GET /:channelId returns empty array when no conversations', async () => {
    mockRows = [];
    const res = await app.request(`/api/conversations/${CHANNEL_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(0);
  });

  test('GET /:channelId/:id returns single conversation', async () => {
    mockRows = [MOCK_CONVERSATION];
    const res = await app.request(`/api/conversations/${CHANNEL_ID}/conv-001`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe('conv-001');
  });

  test('GET /:channelId/:id returns 404 when not found', async () => {
    mockRows = [];
    const res = await app.request(`/api/conversations/${CHANNEL_ID}/nonexistent`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('NOT_FOUND');
  });

  test('GET /:channelId/:id returns 404 for channel mismatch', async () => {
    mockRows = [{ ...MOCK_CONVERSATION, channelId: 'other-channel' }];
    const res = await app.request(`/api/conversations/${CHANNEL_ID}/conv-001`);
    expect(res.status).toBe(404);
  });

  test('POST /:channelId/:id/generate-skill returns 400 when no tool calls', async () => {
    mockRows = [{ ...MOCK_CONVERSATION, messages: [{ role: 'user', content: 'Hello' }] }];
    const res = await app.request(`/api/conversations/${CHANNEL_ID}/conv-001/generate-skill`, {
      method: 'POST',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('NO_TOOL_CALLS');
  });
});
