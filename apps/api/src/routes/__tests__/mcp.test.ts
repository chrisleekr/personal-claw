import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';
const MOCK_MCP = {
  id: 'mcp-001',
  serverName: 'test-server',
  transportType: 'sse',
  serverUrl: 'https://mcp.example.com',
  headers: null,
  command: null,
  args: null,
  env: null,
  cwd: null,
  enabled: true,
  channelId: null,
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
mock.module('../../mcp/config', () => ({ buildTransport: () => ({}) }));

import { Hono } from 'hono';
import { errorHandler } from '../../errors/error-handler';
import { mcpRoute } from '../mcp';

function createApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/api/mcp', mcpRoute);
  return app;
}

function jsonReq(path: string, options: RequestInit = {}) {
  return new Request(`http://localhost${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers as Record<string, string>) },
    ...options,
  });
}

describe('MCP Routes', () => {
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

  test('GET / returns global configs', async () => {
    mockRows = [MOCK_MCP];
    const res = await app.request('/api/mcp');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
  });

  test('GET /channel/:channelId returns channel configs', async () => {
    mockRows = [MOCK_MCP];
    const res = await app.request(`/api/mcp/channel/${CHANNEL_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
  });

  test('POST / creates config with valid SSE input', async () => {
    mockInsertRows = [MOCK_MCP];
    const res = await app.request(
      jsonReq('/api/mcp', {
        method: 'POST',
        body: JSON.stringify({
          serverName: 'test-server',
          transportType: 'sse',
          serverUrl: 'https://mcp.example.com',
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.serverName).toBe('test-server');
  });

  test('POST / returns 400 for SSE without serverUrl', async () => {
    const res = await app.request(
      jsonReq('/api/mcp', {
        method: 'POST',
        body: JSON.stringify({ serverName: 'bad', transportType: 'sse' }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VALIDATION_ERROR');
  });

  test('PUT /:channelId/:id updates config', async () => {
    mockRows = [MOCK_MCP];
    mockUpdateRows = [{ ...MOCK_MCP, serverName: 'updated' }];
    const res = await app.request(
      jsonReq(`/api/mcp/${CHANNEL_ID}/mcp-001`, {
        method: 'PUT',
        body: JSON.stringify({ serverName: 'updated' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.serverName).toBe('updated');
  });

  test('PUT /:channelId/:id returns 404 when not found', async () => {
    mockUpdateRows = [];
    const res = await app.request(
      jsonReq(`/api/mcp/${CHANNEL_ID}/nonexistent`, {
        method: 'PUT',
        body: JSON.stringify({ serverName: 'x' }),
      }),
    );
    expect(res.status).toBe(404);
  });

  test('DELETE /:channelId/:id deletes config', async () => {
    mockRows = [MOCK_MCP];
    mockDeleteRows = [MOCK_MCP];
    const res = await app.request(`/api/mcp/${CHANNEL_ID}/mcp-001`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deleted).toBe(true);
  });

  test('DELETE /:channelId/:id returns 404 when not found', async () => {
    mockDeleteRows = [];
    const res = await app.request(`/api/mcp/${CHANNEL_ID}/nonexistent`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  test('GET /:id/tool-policy returns policy', async () => {
    mockRows = [{ denyList: ['tool_a'] }];
    const res = await app.request(`/api/mcp/mcp-001/tool-policy?channelId=${CHANNEL_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.disabledTools).toEqual(['tool_a']);
  });

  test('DELETE /:id/tool-policy returns 400 without channelId', async () => {
    const res = await app.request('/api/mcp/mcp-001/tool-policy', { method: 'DELETE' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VALIDATION_ERROR');
  });
});
