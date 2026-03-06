import { getLogger } from '@logtape/logtape';
import { and, channels, eq } from '@personalclaw/db';
import type { ChannelPlatform } from '@personalclaw/shared';
import { VALKEY_KEYS, VALKEY_TTL } from '@personalclaw/shared';
import { getDb } from '../db';
import { getRedis, isRedisAvailable } from '../redis';
import { errorDetails } from '../utils/error-fmt';

const logger = getLogger(['personalclaw', 'channels', 'resolver']);

export interface ResolvedChannel {
  id: string;
  platform: ChannelPlatform;
  externalId: string;
}

export class ChannelNotFoundError extends Error {
  constructor(
    public readonly platform: string,
    public readonly externalId: string,
  ) {
    super(`Channel not found: platform=${platform} externalId=${externalId}`);
    this.name = 'ChannelNotFoundError';
  }
}

interface CacheEntry {
  channel: ResolvedChannel;
  expiresAt: number;
}

export class ChannelResolver {
  private static instance: ChannelResolver;
  private memoryCache = new Map<string, CacheEntry>();

  static getInstance(): ChannelResolver {
    if (!ChannelResolver.instance) {
      ChannelResolver.instance = new ChannelResolver();
    }
    return ChannelResolver.instance;
  }

  async resolve(platform: ChannelPlatform, externalId: string): Promise<ResolvedChannel> {
    const cacheKey = this.cacheKey(platform, externalId);

    const memoryCached = this.getFromMemoryCache(cacheKey);
    if (memoryCached) return memoryCached;

    const valkeyCached = await this.getFromValkey(cacheKey);
    if (valkeyCached) {
      this.setMemoryCache(cacheKey, valkeyCached);
      return valkeyCached;
    }

    const channel = await this.lookupFromDb(platform, externalId);
    if (!channel) {
      throw new ChannelNotFoundError(platform, externalId);
    }

    await this.populateCaches(cacheKey, channel);
    return channel;
  }

  invalidate(channelId: string): void {
    for (const [key, entry] of this.memoryCache) {
      if (entry.channel.id === channelId) {
        this.memoryCache.delete(key);
        this.deleteFromValkey(key);
        logger.debug`Invalidated resolver cache for channelId=${channelId}`;
        return;
      }
    }
  }

  invalidateByExternal(platform: ChannelPlatform, externalId: string): void {
    const key = this.cacheKey(platform, externalId);
    this.memoryCache.delete(key);
    this.deleteFromValkey(key);
  }

  private cacheKey(platform: string, externalId: string): string {
    return `${platform}:${externalId}`;
  }

  private getFromMemoryCache(key: string): ResolvedChannel | null {
    const entry = this.memoryCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.memoryCache.delete(key);
      return null;
    }
    return entry.channel;
  }

  private setMemoryCache(key: string, channel: ResolvedChannel): void {
    this.memoryCache.set(key, {
      channel,
      expiresAt: Date.now() + VALKEY_TTL.channelResolver * 1000,
    });
  }

  private async getFromValkey(key: string): Promise<ResolvedChannel | null> {
    if (!isRedisAvailable()) return null;
    try {
      const valkeyKey = VALKEY_KEYS.channelResolver(
        key.split(':')[0],
        key.split(':').slice(1).join(':'),
      );
      const data = await getRedis().get(valkeyKey);
      if (!data) return null;
      return JSON.parse(data) as ResolvedChannel;
    } catch (error) {
      logger.warn('Valkey read failed for channel resolution', errorDetails(error));
      return null;
    }
  }

  private async populateCaches(key: string, channel: ResolvedChannel): Promise<void> {
    this.setMemoryCache(key, channel);

    if (!isRedisAvailable()) return;
    try {
      const valkeyKey = VALKEY_KEYS.channelResolver(channel.platform, channel.externalId);
      await getRedis().set(valkeyKey, JSON.stringify(channel), 'EX', VALKEY_TTL.channelResolver);
    } catch (error) {
      logger.warn('Valkey write failed for channel resolution', errorDetails(error));
    }
  }

  private deleteFromValkey(key: string): void {
    if (!isRedisAvailable()) return;
    const parts = key.split(':');
    const valkeyKey = VALKEY_KEYS.channelResolver(parts[0], parts.slice(1).join(':'));
    getRedis()
      .del(valkeyKey)
      .catch((error) => {
        logger.warn('Valkey delete failed for channel resolution', errorDetails(error));
      });
  }

  private async lookupFromDb(
    platform: ChannelPlatform,
    externalId: string,
  ): Promise<ResolvedChannel | null> {
    const db = getDb();
    const [row] = await db
      .select({
        id: channels.id,
        platform: channels.platform,
        externalId: channels.externalId,
      })
      .from(channels)
      .where(and(eq(channels.platform, platform), eq(channels.externalId, externalId)));

    if (!row) return null;

    return {
      id: row.id,
      platform: row.platform as ChannelPlatform,
      externalId: row.externalId,
    };
  }
}
