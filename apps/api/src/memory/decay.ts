import { getLogger } from '@logtape/logtape';
import { channelMemories, sql } from '@personalclaw/db';
import { MEMORY_DECAY_DAYS } from '@personalclaw/shared';
import cron from 'node-cron';
import { getDb } from '../db';
import { errorDetails } from '../utils/error-fmt';

const logger = getLogger(['personalclaw', 'memory', 'decay']);

export async function cleanupDecayedMemories(): Promise<number> {
  const db = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MEMORY_DECAY_DAYS);

  const deleted = await db
    .delete(channelMemories)
    .where(
      sql`${channelMemories.lastRecalledAt} IS NOT NULL
        AND ${channelMemories.lastRecalledAt} < ${cutoff.toISOString()}::timestamptz
        AND ${channelMemories.recallCount} < 3`,
    )
    .returning({ id: channelMemories.id });

  if (deleted.length > 0) {
    logger.info`Cleaned up ${deleted.length} stale memories not recalled in ${MEMORY_DECAY_DAYS} days`;
  }

  return deleted.length;
}

export function initMemoryDecay(): void {
  cron.schedule('0 3 * * *', async () => {
    try {
      await cleanupDecayedMemories();
    } catch (error) {
      logger.error('Memory decay cleanup failed', errorDetails(error));
    }
  });

  logger.info`Daily cleanup scheduled at 03:00`;
}
