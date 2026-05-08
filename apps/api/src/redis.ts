import { getLogger } from '@logtape/logtape';
import Redis from 'ioredis';
import { redisUrl } from './config';
import { errorDetails } from './utils/error-fmt';

const logger = getLogger(['personalclaw', 'valkey']);

// Atomic INCR-and-EXPIRE in a single Redis round-trip. Registered once per
// connection via defineCommand so subsequent calls go over EVALSHA, avoiding
// re-shipping the Lua body on every rate-limit check.
const RATE_LIMIT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  return {current, tonumber(ARGV[1])}
end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {current, ttl}
`;

export interface RateLimitRedis extends Redis {
  rateLimitIncr(key: string, ttl: string): Promise<[number, number]>;
}

let redisInstance: RateLimitRedis | null = null;

export function getRedis(): RateLimitRedis {
  if (!redisInstance) {
    const r = new Redis(redisUrl(), {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 5) return null;
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
    });

    r.defineCommand('rateLimitIncr', { numberOfKeys: 1, lua: RATE_LIMIT_SCRIPT });

    r.on('error', (err) => {
      logger.error('Valkey connection error', errorDetails(err));
    });

    r.connect().catch((err) => {
      logger.warn('Valkey initial connection failed, will retry', errorDetails(err));
    });

    redisInstance = r as RateLimitRedis;
  }
  return redisInstance;
}

export function isRedisAvailable(): boolean {
  return redisInstance !== null && redisInstance.status === 'ready';
}
