import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

let mockSelectRows: unknown[] = [];
let mockRedisAvailable = false;
let mockRedisStore: Record<string, string> = {};

function chainable(getRows: () => unknown[]): unknown {
  const methods: Record<string, unknown> = {};
  for (const name of ['from', 'where', 'orderBy', 'limit', 'groupBy', 'returning']) {
    methods[name] = () => chainable(getRows);
  }
  return Object.assign([...getRows()], methods);
}

mock.module('../../db', () => ({
  getDb: () => ({
    select: () => chainable(() => mockSelectRows),
  }),
}));

mock.module('../../redis', () => ({
  isRedisAvailable: () => mockRedisAvailable,
  getRedis: () => ({
    get: async (key: string) => mockRedisStore[key] ?? null,
    set: async (key: string, value: string) => {
      mockRedisStore[key] = value;
    },
    del: async (key: string) => {
      delete mockRedisStore[key];
    },
  }),
}));

import { getCachedConfig, invalidateConfig } from '../config-cache';

describe('config-cache', () => {
  beforeEach(() => {
    mockSelectRows = [];
    mockRedisAvailable = false;
    mockRedisStore = {};
  });

  afterEach(() => {
    mockSelectRows = [];
    mockRedisAvailable = false;
    mockRedisStore = {};
  });

  describe('getCachedConfig', () => {
    test('returns null when channel not found', async () => {
      mockSelectRows = [];
      const result = await getCachedConfig('nonexistent');
      expect(result).toBeNull();
    });

    test('returns config from DB when found', async () => {
      mockSelectRows = [
        {
          id: 'ch-1',
          platform: 'slack',
          externalId: 'C123',
          identityPrompt: 'Bot',
          threadReplyMode: 'all',
          autonomyLevel: 'balanced',
        },
      ];
      const result = await getCachedConfig('ch-1');
      expect(result).toBeDefined();
      expect(result?.id).toBe('ch-1');
    });
  });

  describe('invalidateConfig', () => {
    test('does not throw', () => {
      expect(() => invalidateConfig('ch-1')).not.toThrow();
    });
  });
});
