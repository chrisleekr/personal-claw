import { getLogger } from '@logtape/logtape';
import Redis from 'ioredis';
import { redisUrl } from './config';
import { errorDetails } from './utils/error-fmt';

const logger = getLogger(['personalclaw', 'valkey']);

let redisInstance: Redis | null = null;

export function getRedis(): Redis {
  if (!redisInstance) {
    redisInstance = new Redis(redisUrl(), {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 5) return null;
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
    });

    redisInstance.on('error', (err) => {
      logger.error('Valkey connection error', errorDetails(err));
    });

    redisInstance.connect().catch((err) => {
      logger.warn('Valkey initial connection failed, will retry', errorDetails(err));
    });
  }
  return redisInstance;
}

export function isRedisAvailable(): boolean {
  return redisInstance !== null && redisInstance.status === 'ready';
}
