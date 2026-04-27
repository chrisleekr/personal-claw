import { getLogger } from '@logtape/logtape';
import { VALKEY_KEYS, VALKEY_TTL } from '@personalclaw/shared';
import { getRedis, isRedisAvailable } from '../redis';
import { errorDetails } from '../utils/error-fmt';

const logger = getLogger(['personalclaw', 'middleware', 'rate-limiter']);

const DEFAULT_RATE_LIMIT_PER_MINUTE = 30;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

// Atomic INCR + conditional EXPIRE in a single round-trip. The previous
// implementation issued INCR and EXPIRE as separate awaits, which could leave
// an "immortal key" if the process crashed between them or if EXPIRE failed.
// The script returns `[currentCount, ttlSeconds]` so we don't need a second
// TTL round-trip.
const RATE_LIMIT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
local ttl
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
else
  ttl = redis.call('TTL', KEYS[1])
  if ttl < 0 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
    ttl = tonumber(ARGV[1])
  end
end
return {current, ttl}
`;

export async function checkRateLimit(
  channelId: string,
  userId: string,
  limitPerMinute: number = DEFAULT_RATE_LIMIT_PER_MINUTE,
): Promise<RateLimitResult> {
  if (!isRedisAvailable()) {
    return { allowed: true, remaining: limitPerMinute, retryAfterSeconds: 0 };
  }

  const key = VALKEY_KEYS.rateLimitUser(channelId, userId);

  try {
    const redis = getRedis();
    const result = (await redis.eval(
      RATE_LIMIT_SCRIPT,
      1,
      key,
      String(VALKEY_TTL.rateLimitWindow),
    )) as [number, number];
    const [current, ttl] = result;
    const retryAfter = ttl > 0 ? ttl : VALKEY_TTL.rateLimitWindow;

    if (current > limitPerMinute) {
      logger.info('Rate limit exceeded', { channelId, userId, current, limitPerMinute });
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: retryAfter,
      };
    }

    return {
      allowed: true,
      remaining: limitPerMinute - current,
      retryAfterSeconds: 0,
    };
  } catch (error) {
    logger.warn('Rate limit check failed, allowing request', {
      channelId,
      userId,
      ...errorDetails(error),
    });
    return { allowed: true, remaining: limitPerMinute, retryAfterSeconds: 0 };
  }
}
