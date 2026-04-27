import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

let mockRedisAvailable = false;
let mockEvalResult: [number, number] = [0, 60];
let mockEvalError: Error | null = null;
let mockEvalCallCount = 0;

mock.module('../../redis', () => ({
  isRedisAvailable: () => mockRedisAvailable,
  getRedis: () => ({
    eval: async () => {
      mockEvalCallCount++;
      if (mockEvalError) throw mockEvalError;
      return mockEvalResult;
    },
  }),
}));

import { checkRateLimit } from '../rate-limiter';

describe('checkRateLimit', () => {
  const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';
  const USER_ID = 'U12345';

  beforeEach(() => {
    mockRedisAvailable = false;
    mockEvalResult = [0, 60];
    mockEvalError = null;
    mockEvalCallCount = 0;
  });

  afterEach(() => {
    mockRedisAvailable = false;
    mockEvalResult = [0, 60];
    mockEvalError = null;
    mockEvalCallCount = 0;
  });

  test('allows request when Redis is unavailable', async () => {
    mockRedisAvailable = false;
    const result = await checkRateLimit(CHANNEL_ID, USER_ID);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(30);
    expect(result.retryAfterSeconds).toBe(0);
    expect(mockEvalCallCount).toBe(0);
  });

  test('allows request within rate limit', async () => {
    mockRedisAvailable = true;
    mockEvalResult = [1, 60];
    const result = await checkRateLimit(CHANNEL_ID, USER_ID, 10);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
    expect(result.retryAfterSeconds).toBe(0);
  });

  test('denies request exceeding rate limit', async () => {
    mockRedisAvailable = true;
    mockEvalResult = [31, 45];
    const result = await checkRateLimit(CHANNEL_ID, USER_ID, 30);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSeconds).toBe(45);
  });

  test('uses default limit of 30 per minute', async () => {
    mockRedisAvailable = true;
    mockEvalResult = [1, 60];
    const result = await checkRateLimit(CHANNEL_ID, USER_ID);
    expect(result.remaining).toBe(29);
  });

  test('uses custom limit', async () => {
    mockRedisAvailable = true;
    mockEvalResult = [1, 60];
    const result = await checkRateLimit(CHANNEL_ID, USER_ID, 5);
    expect(result.remaining).toBe(4);
  });

  test('returns retryAfterSeconds from script TTL when denied', async () => {
    mockRedisAvailable = true;
    mockEvalResult = [99, 42];
    const result = await checkRateLimit(CHANNEL_ID, USER_ID, 10);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(42);
  });

  test('first hit ([1, ttl]) reflects EXPIRE was applied by script', async () => {
    // The script's `current == 1` branch issues EXPIRE atomically; the
    // returned ttl should equal the configured window. Verify the caller
    // uses that ttl rather than re-querying.
    mockRedisAvailable = true;
    mockEvalResult = [1, 60];
    const result = await checkRateLimit(CHANNEL_ID, USER_ID, 5);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    // Only one Redis round-trip per check.
    expect(mockEvalCallCount).toBe(1);
  });

  test('falls back to allow when Redis call fails', async () => {
    mockRedisAvailable = true;
    mockEvalError = new Error('redis down');
    const result = await checkRateLimit(CHANNEL_ID, USER_ID, 10);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(10);
    expect(result.retryAfterSeconds).toBe(0);
  });
});
