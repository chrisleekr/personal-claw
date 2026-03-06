import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';

const MOCK_CHANNEL = {
  id: CHANNEL_ID,
  platform: 'slack',
  externalId: 'C12345',
  model: 'claude-sonnet-4-20250514',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const MOCK_SKILL = {
  id: 'skill-001',
  channelId: CHANNEL_ID,
  name: 'Deploy Helper',
  content: 'Helps with deployments',
  allowedTools: [],
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const MOCK_MEMORY = {
  id: 'mem-001',
  channelId: CHANNEL_ID,
  content: 'User prefers dark mode',
  category: 'preference',
  recallCount: 5,
  createdAt: new Date(),
  updatedAt: new Date(),
};

let mockRows: unknown[] = [];
let mockInsertRows: unknown[] = [];
let mockUpdateRows: unknown[] = [];
let mockDeleteRows: unknown[] = [];

function chainable(getRows: () => unknown[]): unknown {
  const arr = getRows();
  const methods: Record<string, unknown> = {};
  for (const name of ['from', 'where', 'orderBy', 'limit', 'groupBy', 'returning']) {
    methods[name] = () => chainable(getRows);
  }
  return Object.assign([...arr], methods);
}

mock.module('../../db', () => ({
  getDb: () => ({
    select: () => chainable(() => mockRows),
    insert: () => ({
      values: () => ({
        returning: () => [...mockInsertRows],
      }),
    }),
    update: () => ({
      set: () => chainable(() => mockUpdateRows),
    }),
    delete: () => chainable(() => mockDeleteRows),
  }),
}));

mock.module('../../channels/config-cache', () => ({
  invalidateConfig: () => {},
  getCachedConfig: async () => null,
}));

mock.module('../../redis', () => ({
  isRedisAvailable: () => false,
  getRedis: () => null,
}));

mock.module('../../config/hot-reload', () => ({
  emitConfigChange: () => {},
}));

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
import { memoriesRoute } from '../memories';
import { skillsRoute } from '../skills';
import { usageRoute } from '../usage';

function createTestApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));
  app.route('/api/channels', channelsRoute);
  app.route('/api/skills', skillsRoute);
  app.route('/api/memories', memoriesRoute);
  app.route('/api/usage', usageRoute);
  return app;
}

function jsonReq(path: string, options: RequestInit = {}) {
  return new Request(`http://localhost${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    },
    ...options,
  });
}

describe('Routes', () => {
  let app: Hono;

  beforeEach(() => {
    app = createTestApp();
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

  describe('GET /health', () => {
    test('returns status ok', async () => {
      const res = await app.request('/health');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('ok');
      expect(body.timestamp).toBeDefined();
    });
  });

  describe('/api/channels', () => {
    test('GET / returns channel list wrapped in data', async () => {
      mockRows = [MOCK_CHANNEL];
      const res = await app.request('/api/channels');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toBeArray();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].externalId).toBe('C12345');
    });

    test('GET /:id returns single channel', async () => {
      mockRows = [MOCK_CHANNEL];
      const res = await app.request(`/api/channels/${CHANNEL_ID}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe(CHANNEL_ID);
    });

    test('GET /:id returns 404 when not found', async () => {
      mockRows = [];
      const res = await app.request('/api/channels/nonexistent');
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('NOT_FOUND');
    });

    test('POST / creates channel with valid input', async () => {
      mockInsertRows = [{ ...MOCK_CHANNEL, externalId: 'C99999' }];
      const res = await app.request(
        jsonReq('/api/channels', {
          method: 'POST',
          body: JSON.stringify({ externalId: 'C99999' }),
        }),
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.externalId).toBe('C99999');
    });

    test('POST / returns 400 for missing externalId', async () => {
      const res = await app.request(
        jsonReq('/api/channels', {
          method: 'POST',
          body: JSON.stringify({}),
        }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('VALIDATION_ERROR');
      expect(body.details).toBeArray();
    });

    test('DELETE /:id deletes channel', async () => {
      mockDeleteRows = [MOCK_CHANNEL];
      const res = await app.request(`/api/channels/${CHANNEL_ID}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.deleted).toBe(true);
    });

    test('DELETE /:id returns 404 when not found', async () => {
      mockDeleteRows = [];
      const res = await app.request('/api/channels/nonexistent', {
        method: 'DELETE',
      });
      expect(res.status).toBe(404);
    });
  });

  describe('/api/skills', () => {
    test('GET /:channelId returns skill list', async () => {
      mockRows = [MOCK_SKILL];
      const res = await app.request(`/api/skills/${CHANNEL_ID}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toBeArray();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe('Deploy Helper');
    });

    test('POST / creates skill with valid input', async () => {
      mockInsertRows = [MOCK_SKILL];
      const res = await app.request(
        jsonReq('/api/skills', {
          method: 'POST',
          body: JSON.stringify({
            channelId: CHANNEL_ID,
            name: 'New Skill',
            content: 'Does things',
          }),
        }),
      );
      expect(res.status).toBe(201);
    });

    test('POST / returns 400 for empty name', async () => {
      const res = await app.request(
        jsonReq('/api/skills', {
          method: 'POST',
          body: JSON.stringify({
            channelId: CHANNEL_ID,
            name: '',
            content: 'test',
          }),
        }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('VALIDATION_ERROR');
    });

    test('DELETE /:id returns 404 when not found', async () => {
      mockDeleteRows = [];
      const res = await app.request('/api/skills/nonexistent', {
        method: 'DELETE',
      });
      expect(res.status).toBe(404);
    });
  });

  describe('/api/memories', () => {
    test('GET /:channelId returns memories', async () => {
      mockRows = [MOCK_MEMORY];
      const res = await app.request(`/api/memories/${CHANNEL_ID}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toBeArray();
      expect(body.data).toHaveLength(1);
    });

    test('GET /:channelId/search returns results', async () => {
      mockRows = [MOCK_MEMORY];
      const res = await app.request(`/api/memories/${CHANNEL_ID}/search?q=dark`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toBeArray();
    });

    test('PATCH /:id returns 400 for empty content', async () => {
      const res = await app.request(
        jsonReq('/api/memories/mem-001', {
          method: 'PATCH',
          body: JSON.stringify({ content: '' }),
        }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('VALIDATION_ERROR');
    });

    test('PATCH /:id updates memory', async () => {
      mockUpdateRows = [{ ...MOCK_MEMORY, content: 'Updated' }];
      const res = await app.request(
        jsonReq('/api/memories/mem-001', {
          method: 'PATCH',
          body: JSON.stringify({ content: 'Updated' }),
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.content).toBe('Updated');
    });

    test('DELETE /:id returns 404 when not found', async () => {
      mockDeleteRows = [];
      const res = await app.request('/api/memories/mem-001', {
        method: 'DELETE',
      });
      expect(res.status).toBe(404);
    });
  });

  describe('/api/usage', () => {
    test('GET /pricing returns model pricing list', async () => {
      const res = await app.request('/api/usage/pricing');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toBeArray();
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data[0]).toHaveProperty('model');
      expect(body.data[0]).toHaveProperty('pricing');
    });
  });
});
