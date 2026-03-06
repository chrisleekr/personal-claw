import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

let mockRedisAvailable = false;
let mockRedisStore: Record<string, string> = {};

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

import { WorkingMemory } from '../working';

describe('WorkingMemory', () => {
  let wm: WorkingMemory;
  const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';
  const THREAD_ID = 'thread-001';

  beforeEach(() => {
    wm = new WorkingMemory();
    mockRedisAvailable = false;
    mockRedisStore = {};
  });

  afterEach(() => {
    mockRedisStore = {};
  });

  describe('get', () => {
    test('returns null when Redis unavailable', async () => {
      mockRedisAvailable = false;
      const result = await wm.get(CHANNEL_ID, THREAD_ID);
      expect(result).toBeNull();
    });

    test('returns null when key not found', async () => {
      mockRedisAvailable = true;
      const result = await wm.get(CHANNEL_ID, THREAD_ID);
      expect(result).toBeNull();
    });

    test('returns parsed ThreadState when data exists', async () => {
      mockRedisAvailable = true;
      const state = {
        messages: [{ role: 'user', content: 'Hello' }],
        channelId: CHANNEL_ID,
        threadId: THREAD_ID,
        lastActivityAt: '2026-01-01T00:00:00Z',
      };
      mockRedisStore[`thread:${CHANNEL_ID}:${THREAD_ID}`] = JSON.stringify(state);
      const result = await wm.get(CHANNEL_ID, THREAD_ID);
      expect(result).toEqual(state);
    });
  });

  describe('set', () => {
    test('does nothing when Redis unavailable', async () => {
      mockRedisAvailable = false;
      await wm.set(CHANNEL_ID, THREAD_ID, {
        messages: [],
        channelId: CHANNEL_ID,
        threadId: THREAD_ID,
        lastActivityAt: '2026-01-01T00:00:00Z',
      });
      expect(Object.keys(mockRedisStore)).toHaveLength(0);
    });

    test('stores data in Redis when available', async () => {
      mockRedisAvailable = true;
      const state = {
        messages: [{ role: 'user' as const, content: 'Hello' }],
        channelId: CHANNEL_ID,
        threadId: THREAD_ID,
        lastActivityAt: '2026-01-01T00:00:00Z',
      };
      await wm.set(CHANNEL_ID, THREAD_ID, state);
      expect(Object.keys(mockRedisStore).length).toBeGreaterThan(0);
    });
  });

  describe('delete', () => {
    test('does nothing when Redis unavailable', async () => {
      mockRedisAvailable = false;
      await wm.delete(CHANNEL_ID, THREAD_ID);
    });

    test('removes key from Redis when available', async () => {
      mockRedisAvailable = true;
      const key = `thread:${CHANNEL_ID}:${THREAD_ID}`;
      mockRedisStore[key] = 'data';
      await wm.delete(CHANNEL_ID, THREAD_ID);
      expect(mockRedisStore[key]).toBeUndefined();
    });
  });
});
