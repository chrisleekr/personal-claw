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

// Coerce Redis return values (numbers, bulk strings, bigints) to a finite
// JS number; anything unparseable falls back to 0 so `remaining` and TTL
// math never produce NaN.
function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value === 'bigint') return Number(value);
  return 0;
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
    // Custom command registered in `redis.ts` via `defineCommand` — first
    // call ships the Lua body, subsequent calls go over EVALSHA. Atomic
    // INCR + EXPIRE eliminates the immortal-key bug where a crash between
    // separate INCR/EXPIRE calls leaves a counter with no TTL; the script
    // also re-applies the TTL if a key has none, self-healing legacy keys.
    const result = (await redis.rateLimitIncr(key, String(VALKEY_TTL.rateLimitWindow))) as [
      unknown,
      unknown,
    ];

    const current = toNumber(result?.[0]);
    const ttl = toNumber(result?.[1]);
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
