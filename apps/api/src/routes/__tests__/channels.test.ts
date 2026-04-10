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
// Track calls to `invalidateConfig` so the guardrailsConfig PATCH tests can
// assert the config cache is invalidated after a successful write (FR-018).
const invalidateConfigCalls: string[] = [];
mock.module('../../channels/config-cache', () => ({
  invalidateConfig: (channelId: string) => {
    invalidateConfigCalls.push(channelId);
  },
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
    invalidateConfigCalls.length = 0;
  });

  afterEach(() => {
    mockRows = [];
    mockInsertRows = [];
    mockUpdateRows = [];
    mockDeleteRows = [];
    invalidateConfigCalls.length = 0;
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

  // -------------------------------------------------------------------
  // T063 — PUT /:id extended guardrailsConfig fields
  //
  // The `updateChannelSchema` already accepts the full `guardrailsConfig`
  // shape (createChannelSchema.partial() includes guardrailsConfig), and
  // the guardrailsConfigSchema has been extended across phase 2 / 3 / 6
  // to cover: defenseProfile, canaryTokenEnabled, auditRetentionDays,
  // detection.* (including the new optional classifierEnabled per Option 2).
  // These tests validate that the route accepts the new fields, validates
  // bounds correctly, and invalidates the config cache on every write
  // per fr-018.
  // -------------------------------------------------------------------
  describe('T063 — guardrailsConfig PATCH via PUT /:id', () => {
    test('accepts all new guardrailsConfig fields (defenseProfile, canaryTokenEnabled, auditRetentionDays, detection.*)', async () => {
      mockUpdateRows = [
        {
          ...MOCK_CHANNEL,
          guardrailsConfig: {
            preProcessing: {
              contentFiltering: true,
              intentClassification: false,
              maxInputLength: 50000,
            },
            postProcessing: { piiRedaction: true, outputValidation: true },
            defenseProfile: 'balanced',
            canaryTokenEnabled: true,
            auditRetentionDays: 14,
            detection: {
              heuristicThreshold: 60,
              similarityThreshold: 0.85,
              similarityShortCircuitThreshold: 0.92,
              classifierTimeoutMs: 3000,
            },
          },
        },
      ];
      const res = await app.request(
        jsonReq(`/api/channels/${CHANNEL_ID}`, {
          method: 'PUT',
          body: JSON.stringify({
            guardrailsConfig: {
              preProcessing: {
                contentFiltering: true,
                intentClassification: false,
                maxInputLength: 50000,
              },
              postProcessing: { piiRedaction: true, outputValidation: true },
              defenseProfile: 'balanced',
              canaryTokenEnabled: true,
              auditRetentionDays: 14,
              detection: {
                heuristicThreshold: 60,
                similarityThreshold: 0.85,
                similarityShortCircuitThreshold: 0.92,
                classifierTimeoutMs: 3000,
              },
            },
          }),
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.guardrailsConfig.defenseProfile).toBe('balanced');
      expect(body.data.guardrailsConfig.canaryTokenEnabled).toBe(true);
      expect(body.data.guardrailsConfig.auditRetentionDays).toBe(14);
      expect(body.data.guardrailsConfig.detection.heuristicThreshold).toBe(60);
    });

    test('rejects auditRetentionDays below the bound (1) with 400', async () => {
      const res = await app.request(
        jsonReq(`/api/channels/${CHANNEL_ID}`, {
          method: 'PUT',
          body: JSON.stringify({
            guardrailsConfig: {
              preProcessing: {
                contentFiltering: true,
                intentClassification: false,
                maxInputLength: 50000,
              },
              postProcessing: { piiRedaction: true, outputValidation: true },
              auditRetentionDays: 0,
            },
          }),
        }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('VALIDATION_ERROR');
    });

    test('rejects auditRetentionDays above the bound (90) with 400', async () => {
      const res = await app.request(
        jsonReq(`/api/channels/${CHANNEL_ID}`, {
          method: 'PUT',
          body: JSON.stringify({
            guardrailsConfig: {
              preProcessing: {
                contentFiltering: true,
                intentClassification: false,
                maxInputLength: 50000,
              },
              postProcessing: { piiRedaction: true, outputValidation: true },
              auditRetentionDays: 91,
            },
          }),
        }),
      );
      expect(res.status).toBe(400);
    });

    test('rejects invalid defenseProfile values with 400', async () => {
      const res = await app.request(
        jsonReq(`/api/channels/${CHANNEL_ID}`, {
          method: 'PUT',
          body: JSON.stringify({
            guardrailsConfig: {
              preProcessing: {
                contentFiltering: true,
                intentClassification: false,
                maxInputLength: 50000,
              },
              postProcessing: { piiRedaction: true, outputValidation: true },
              defenseProfile: 'paranoid', // not in strict|balanced|permissive enum
            },
          }),
        }),
      );
      expect(res.status).toBe(400);
    });

    test('rejects detection.similarityShortCircuitThreshold < similarityThreshold with 400 (cross-field constraint)', async () => {
      const res = await app.request(
        jsonReq(`/api/channels/${CHANNEL_ID}`, {
          method: 'PUT',
          body: JSON.stringify({
            guardrailsConfig: {
              preProcessing: {
                contentFiltering: true,
                intentClassification: false,
                maxInputLength: 50000,
              },
              postProcessing: { piiRedaction: true, outputValidation: true },
              detection: {
                heuristicThreshold: 60,
                similarityThreshold: 0.92,
                similarityShortCircuitThreshold: 0.5, // lower than fire threshold
                classifierTimeoutMs: 3000,
              },
            },
          }),
        }),
      );
      expect(res.status).toBe(400);
    });

    test('invalidates the channel config cache on a successful write (FR-018)', async () => {
      mockUpdateRows = [
        {
          ...MOCK_CHANNEL,
          guardrailsConfig: {
            preProcessing: {
              contentFiltering: true,
              intentClassification: false,
              maxInputLength: 50000,
            },
            postProcessing: { piiRedaction: true, outputValidation: true },
            defenseProfile: 'strict',
          },
        },
      ];
      expect(invalidateConfigCalls.length).toBe(0);
      const res = await app.request(
        jsonReq(`/api/channels/${CHANNEL_ID}`, {
          method: 'PUT',
          body: JSON.stringify({
            guardrailsConfig: {
              preProcessing: {
                contentFiltering: true,
                intentClassification: false,
                maxInputLength: 50000,
              },
              postProcessing: { piiRedaction: true, outputValidation: true },
              defenseProfile: 'strict',
            },
          }),
        }),
      );
      expect(res.status).toBe(200);
      expect(invalidateConfigCalls).toEqual([CHANNEL_ID]);
    });

    test('does NOT invalidate the config cache on a failed write (404 not found)', async () => {
      mockUpdateRows = []; // no rows returned → 404
      const res = await app.request(
        jsonReq(`/api/channels/${CHANNEL_ID}`, {
          method: 'PUT',
          body: JSON.stringify({
            guardrailsConfig: {
              preProcessing: {
                contentFiltering: true,
                intentClassification: false,
                maxInputLength: 50000,
              },
              postProcessing: { piiRedaction: true, outputValidation: true },
              defenseProfile: 'strict',
            },
          }),
        }),
      );
      expect(res.status).toBe(404);
      expect(invalidateConfigCalls).toEqual([]);
    });
  });
});
