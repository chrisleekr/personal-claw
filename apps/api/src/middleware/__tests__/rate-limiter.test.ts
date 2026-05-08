import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

let mockRedisAvailable = false;
let mockEvalReturn: [number, number] = [0, 60];
let mockEvalThrows = false;
let mockEvalCalls = 0;

mock.module('../../redis', () => ({
  isRedisAvailable: () => mockRedisAvailable,
  getRedis: () => ({
    // Custom command registered via defineCommand in redis.ts — the
    // production call site uses redis.rateLimitIncr(key, ttl), and the
    // mock mirrors that surface so we exercise the real path.
    rateLimitIncr: async () => {
      mockEvalCalls++;
      if (mockEvalThrows) throw new Error('redis eval failed');
      return mockEvalReturn;
    },
  }),
}));

import { checkRateLimit } from '../rate-limiter';

describe('checkRateLimit', () => {
  const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';
  const USER_ID = 'U12345';

  beforeEach(() => {
    mockRedisAvailable = false;
    mockEvalReturn = [0, 60];
    mockEvalThrows = false;
    mockEvalCalls = 0;
  });

  afterEach(() => {
    mockRedisAvailable = false;
    mockEvalReturn = [0, 60];
    mockEvalThrows = false;
    mockEvalCalls = 0;
  });

  test('allows request when Redis is unavailable', async () => {
    mockRedisAvailable = false;
    const result = await checkRateLimit(CHANNEL_ID, USER_ID);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(30);
    expect(result.retryAfterSeconds).toBe(0);
    // Script must not run when Redis is unavailable.
    expect(mockEvalCalls).toBe(0);
  });

  test('allows request within rate limit', async () => {
    mockRedisAvailable = true;
    mockEvalReturn = [1, 60];
    const result = await checkRateLimit(CHANNEL_ID, USER_ID, 10);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
    expect(result.retryAfterSeconds).toBe(0);
    // One round-trip per check.
    expect(mockEvalCalls).toBe(1);
  });

  test('denies request exceeding rate limit', async () => {
    mockRedisAvailable = true;
    mockEvalReturn = [31, 30];
    const result = await checkRateLimit(CHANNEL_ID, USER_ID, 30);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  test('uses default limit of 30 per minute', async () => {
    mockRedisAvailable = true;
    mockEvalReturn = [1, 60];
    const result = await checkRateLimit(CHANNEL_ID, USER_ID);
    expect(result.remaining).toBe(29);
  });

  test('uses custom limit', async () => {
    mockRedisAvailable = true;
    mockEvalReturn = [1, 60];
    const result = await checkRateLimit(CHANNEL_ID, USER_ID, 5);
    expect(result.remaining).toBe(4);
  });

  test('returns retryAfterSeconds from script TTL when denied', async () => {
    mockRedisAvailable = true;
    mockEvalReturn = [99, 42];
    const result = await checkRateLimit(CHANNEL_ID, USER_ID, 10);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(42);
  });

  test('first hit (count=1) carries the freshly applied TTL', async () => {
    mockRedisAvailable = true;
    // Script returns [current=1, ttl=window] when it just applied EXPIRE.
    mockEvalReturn = [1, 60];
    const result = await checkRateLimit(CHANNEL_ID, USER_ID, 10);
    expect(result.allowed).toBe(true);
    // Allowed → retryAfterSeconds is 0 by contract; the TTL is observable
    // via a denied response, exercised in the previous test.
    expect(result.retryAfterSeconds).toBe(0);
  });

  test('falls back to allow when redis.eval throws', async () => {
    mockRedisAvailable = true;
    mockEvalThrows = true;
    const result = await checkRateLimit(CHANNEL_ID, USER_ID, 5);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(5);
    expect(result.retryAfterSeconds).toBe(0);
  });

  test('handles string-typed numbers from redis.eval (defensive)', async () => {
    mockRedisAvailable = true;
    // Some Redis client serializers stringify Lua numbers — verify we coerce.
    mockEvalReturn = ['1' as unknown as number, '60' as unknown as number];
    const result = await checkRateLimit(CHANNEL_ID, USER_ID, 10);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
  });

  test('coerces non-numeric Redis returns to 0 instead of NaN', async () => {
    mockRedisAvailable = true;
    // Defensive: a misbehaving Redis (or buffer-mode response) could surface
    // an empty string or garbage where we expect a number. `remaining` and
    // TTL math must stay finite.
    mockEvalReturn = ['' as unknown as number, 'abc' as unknown as number];
    const result = await checkRateLimit(CHANNEL_ID, USER_ID, 10);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(10);
    expect(Number.isFinite(result.remaining)).toBe(true);
    expect(Number.isFinite(result.retryAfterSeconds)).toBe(true);
  });
});
