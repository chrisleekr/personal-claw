import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

let mockRedisAvailable = false;
let mockIncrValue = 0;
let mockTtlValue = 50;

mock.module('../../redis', () => ({
  isRedisAvailable: () => mockRedisAvailable,
  getRedis: () => ({
    incr: async () => {
      mockIncrValue++;
      return mockIncrValue;
    },
    expire: async () => {},
    ttl: async () => mockTtlValue,
  }),
}));

import { checkRateLimit } from '../rate-limiter';

describe('checkRateLimit', () => {
  const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';
  const USER_ID = 'U12345';

  beforeEach(() => {
    mockRedisAvailable = false;
    mockIncrValue = 0;
    mockTtlValue = 50;
  });

  afterEach(() => {
    mockRedisAvailable = false;
    mockIncrValue = 0;
    mockTtlValue = 50;
  });

  test('allows request when Redis is unavailable', async () => {
    mockRedisAvailable = false;
    const result = await checkRateLimit(CHANNEL_ID, USER_ID);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(30);
    expect(result.retryAfterSeconds).toBe(0);
  });

  test('allows request within rate limit', async () => {
    mockRedisAvailable = true;
    mockIncrValue = 0;
    const result = await checkRateLimit(CHANNEL_ID, USER_ID, 10);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
    expect(result.retryAfterSeconds).toBe(0);
  });

  test('denies request exceeding rate limit', async () => {
    mockRedisAvailable = true;
    mockIncrValue = 30;
    const result = await checkRateLimit(CHANNEL_ID, USER_ID, 30);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  test('uses default limit of 30 per minute', async () => {
    mockRedisAvailable = true;
    mockIncrValue = 0;
    const result = await checkRateLimit(CHANNEL_ID, USER_ID);
    expect(result.remaining).toBe(29);
  });

  test('uses custom limit', async () => {
    mockRedisAvailable = true;
    mockIncrValue = 0;
    const result = await checkRateLimit(CHANNEL_ID, USER_ID, 5);
    expect(result.remaining).toBe(4);
  });

  test('returns retryAfterSeconds from TTL when denied', async () => {
    mockRedisAvailable = true;
    mockIncrValue = 99;
    mockTtlValue = 42;
    const result = await checkRateLimit(CHANNEL_ID, USER_ID, 10);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(42);
  });
});
