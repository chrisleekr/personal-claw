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

// Atomic INCR-and-EXPIRE in a single Redis round-trip. Using a Lua script
// avoids the immortal-key bug where a process crash between separate INCR
// and EXPIRE calls leaves a counter with no TTL, permanently rate-limiting
// the user. The script also re-applies the TTL if a previous run left the
// key without one (PTTL/TTL returns -1) so legacy keys self-heal.
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

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
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
    const result = (await redis.eval(
      RATE_LIMIT_SCRIPT,
      1,
      key,
      String(VALKEY_TTL.rateLimitWindow),
    )) as [unknown, unknown];

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
