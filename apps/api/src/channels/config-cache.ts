import { getLogger } from '@logtape/logtape';
import { channels, eq } from '@personalclaw/db';
import {
  autonomyLevelSchema,
  channelPlatformSchema,
  threadReplyModeSchema,
  VALKEY_KEYS,
  VALKEY_TTL,
} from '@personalclaw/shared';
import { getDb } from '../db';
import { getRedis, isRedisAvailable } from '../redis';
import { errorDetails } from '../utils/error-fmt';

const logger = getLogger(['personalclaw', 'channels', 'config-cache']);

type ChannelRow = typeof channels.$inferSelect;

interface CacheEntry {
  config: ChannelRow;
  expiresAt: number;
}

const memoryCache = new Map<string, CacheEntry>();
const MEMORY_TTL_MS = VALKEY_TTL.channelConfig * 1000;

function getFromMemoryCache(channelId: string): ChannelRow | null {
  const entry = memoryCache.get(channelId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(channelId);
    return null;
  }
  return entry.config;
}

function setMemoryCache(channelId: string, config: ChannelRow): void {
  memoryCache.set(channelId, {
    config,
    expiresAt: Date.now() + MEMORY_TTL_MS,
  });
}

function validateEnumFields(channelId: string, row: ChannelRow): ChannelRow {
  const platform = channelPlatformSchema.safeParse(row.platform);
  if (!platform.success) {
    logger.warn('Invalid platform in channel config, defaulting to slack', { channelId });
    row = { ...row, platform: 'slack' };
  }

  const replyMode = threadReplyModeSchema.safeParse(row.threadReplyMode);
  if (!replyMode.success) {
    logger.warn('Invalid threadReplyMode in channel config, defaulting to all', { channelId });
    row = { ...row, threadReplyMode: 'all' };
  }

  const autonomy = autonomyLevelSchema.safeParse(row.autonomyLevel);
  if (!autonomy.success) {
    logger.warn('Invalid autonomyLevel in channel config, defaulting to balanced', { channelId });
    row = { ...row, autonomyLevel: 'balanced' };
  }

  return row;
}

async function getFromValkey(channelId: string): Promise<ChannelRow | null> {
  if (!isRedisAvailable()) return null;
  try {
    const data = await getRedis().get(VALKEY_KEYS.channelConfig(channelId));
    if (!data) return null;
    const row = JSON.parse(data) as ChannelRow;
    return validateEnumFields(channelId, row);
  } catch (error) {
    logger.warn('Valkey read failed for channel config', { channelId, ...errorDetails(error) });
    return null;
  }
}

async function setValkey(channelId: string, config: ChannelRow): Promise<void> {
  if (!isRedisAvailable()) return;
  try {
    await getRedis().set(
      VALKEY_KEYS.channelConfig(channelId),
      JSON.stringify(config),
      'EX',
      VALKEY_TTL.channelConfig,
    );
  } catch (error) {
    logger.warn('Valkey write failed for channel config', { channelId, ...errorDetails(error) });
  }
}

export async function getCachedConfig(channelId: string): Promise<ChannelRow | null> {
  const memoryCached = getFromMemoryCache(channelId);
  if (memoryCached) return memoryCached;

  const valkeyCached = await getFromValkey(channelId);
  if (valkeyCached) {
    setMemoryCache(channelId, valkeyCached);
    return valkeyCached;
  }

  const db = getDb();
  const [rawRow] = await db.select().from(channels).where(eq(channels.id, channelId));
  if (!rawRow) return null;

  const row = validateEnumFields(channelId, rawRow);
  setMemoryCache(channelId, row);
  await setValkey(channelId, row);
  return row;
}

export function invalidateConfig(channelId: string): void {
  memoryCache.delete(channelId);

  if (!isRedisAvailable()) return;
  getRedis()
    .del(VALKEY_KEYS.channelConfig(channelId))
    .catch((error) => {
      logger.warn('Valkey delete failed for channel config', { channelId, ...errorDetails(error) });
    });
}
