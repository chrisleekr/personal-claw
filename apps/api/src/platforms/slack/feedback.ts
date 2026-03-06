import { getLogger } from '@logtape/logtape';
import { skillUsages, sql } from '@personalclaw/db';
import { VALKEY_KEYS } from '@personalclaw/shared';
import { getDb } from '../../db';
import { LongTermMemory } from '../../memory/longterm';
import { getRedis, isRedisAvailable } from '../../redis';
import { SkillAutoGenerator } from '../../skills/auto-generator';
import { errorDetails } from '../../utils/error-fmt';

const logger = getLogger(['personalclaw', 'slack', 'feedback']);

const POSITIVE_REACTIONS = new Set(['+1', 'thumbsup', 'white_check_mark', 'heart', 'tada']);
const NEGATIVE_REACTIONS = new Set(['-1', 'thumbsdown', 'x']);

interface FeedbackMeta {
  toolSequence: string[];
  skillIds: string[];
  userId: string;
}

export function classifyReaction(reaction: string): 'positive' | 'negative' | null {
  if (POSITIVE_REACTIONS.has(reaction)) return 'positive';
  if (NEGATIVE_REACTIONS.has(reaction)) return 'negative';
  return null;
}

export async function handleReactionFeedback(
  channelId: string,
  threadId: string,
  reaction: string,
  reactingUserId: string,
): Promise<void> {
  const sentiment = classifyReaction(reaction);
  if (!sentiment) return;

  if (!isRedisAvailable()) {
    logger.debug('Valkey not available, skipping feedback processing');
    return;
  }

  const feedbackKey = VALKEY_KEYS.feedbackMeta(channelId, threadId);
  let meta: FeedbackMeta | null = null;
  try {
    const raw = await getRedis().get(feedbackKey);
    if (raw) {
      meta = JSON.parse(raw) as FeedbackMeta;
    }
  } catch (error) {
    logger.warn('Failed to read feedback metadata from Valkey', { ...errorDetails(error) });
    return;
  }

  if (!meta) {
    logger.debug('No feedback metadata found for thread', { channelId, threadId });
    return;
  }

  const isPositive = sentiment === 'positive';
  const autoGen = new SkillAutoGenerator();

  try {
    await autoGen.trackPattern(channelId, meta.toolSequence, isPositive);
  } catch (error) {
    logger.warn('Failed to track pattern', { channelId, ...errorDetails(error) });
  }

  if (isPositive) {
    try {
      await autoGen.checkForGeneration(channelId);
    } catch (error) {
      logger.warn('Failed to check for skill generation', { channelId, ...errorDetails(error) });
    }

    try {
      const longterm = new LongTermMemory();
      const toolNames = meta.toolSequence.join(', ');
      await longterm.save(
        channelId,
        `User reacted positively to an interaction using tools: ${toolNames}. This approach was helpful.`,
        'fact',
        threadId,
      );
    } catch (error) {
      logger.warn('Failed to save feedback memory', { channelId, ...errorDetails(error) });
    }
  }

  if (meta.skillIds.length > 0) {
    try {
      const db = getDb();
      await db
        .update(skillUsages)
        .set({ wasHelpful: isPositive })
        .where(
          sql`${skillUsages.channelId} = ${channelId}
            AND ${skillUsages.skillId} IN ${meta.skillIds}
            AND ${skillUsages.externalUserId} = ${meta.userId}
            AND ${skillUsages.wasHelpful} IS NULL`,
        );
    } catch (error) {
      logger.warn('Failed to update skill usage feedback', { channelId, ...errorDetails(error) });
    }
  }

  logger.info('Processed reaction feedback', {
    channelId,
    threadId,
    reaction,
    sentiment,
    toolCount: meta.toolSequence.length,
    skillCount: meta.skillIds.length,
    reactingUserId,
  });
}
