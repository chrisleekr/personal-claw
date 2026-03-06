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
    const current = await redis.incr(key);

    if (current === 1) {
      await redis.expire(key, VALKEY_TTL.rateLimitWindow);
    }

    const ttl = await redis.ttl(key);
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
