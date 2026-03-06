import { getLogger } from '@logtape/logtape';
import type { ThreadState } from '@personalclaw/shared';
import { VALKEY_KEYS, VALKEY_TTL } from '@personalclaw/shared';
import { getRedis, isRedisAvailable } from '../redis';
import { errorDetails } from '../utils/error-fmt';

const logger = getLogger(['personalclaw', 'memory', 'working']);

export class WorkingMemory {
  async get(channelId: string, threadId: string): Promise<ThreadState | null> {
    if (!isRedisAvailable()) return null;

    try {
      const key = VALKEY_KEYS.threadState(channelId, threadId);
      const data = await getRedis().get(key);
      if (!data) return null;
      return JSON.parse(data) as ThreadState;
    } catch (error) {
      logger.error('Working memory get failed', { channelId, threadId, ...errorDetails(error) });
      return null;
    }
  }

  async set(channelId: string, threadId: string, data: ThreadState): Promise<void> {
    if (!isRedisAvailable()) return;

    try {
      const key = VALKEY_KEYS.threadState(channelId, threadId);
      await getRedis().set(key, JSON.stringify(data), 'EX', VALKEY_TTL.threadState);
    } catch (error) {
      logger.error('Working memory set failed', { channelId, threadId, ...errorDetails(error) });
    }
  }

  async delete(channelId: string, threadId: string): Promise<void> {
    if (!isRedisAvailable()) return;

    try {
      const key = VALKEY_KEYS.threadState(channelId, threadId);
      await getRedis().del(key);
    } catch (error) {
      logger.error('Working memory delete failed', { channelId, threadId, ...errorDetails(error) });
    }
  }
}
