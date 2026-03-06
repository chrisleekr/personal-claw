import { getLogger } from '@logtape/logtape';
import { and, channels, eq } from '@personalclaw/db';
import type { ChannelPlatform, LLMProvider } from '@personalclaw/shared';
import { DEFAULT_BEDROCK_MODEL, DEFAULT_MODEL, DEFAULT_PROVIDER } from '@personalclaw/shared';
import { config } from '../config';
import { getDb } from '../db';
import { PlatformRegistry } from '../platforms/registry';
import type { ResolvedChannel } from './resolver';

const logger = getLogger(['personalclaw', 'channels', 'auto-register']);

export async function autoRegisterChannel(
  platform: ChannelPlatform,
  externalId: string,
): Promise<ResolvedChannel> {
  const db = getDb();

  const provider = (config.LLM_PROVIDER as LLMProvider) || DEFAULT_PROVIDER;
  const model =
    provider === 'bedrock' ? config.AWS_BEDROCK_MODEL || DEFAULT_BEDROCK_MODEL : DEFAULT_MODEL;

  const [inserted] = await db
    .insert(channels)
    .values({ platform, externalId, provider, model })
    .onConflictDoNothing({
      target: [channels.platform, channels.externalId],
    })
    .returning({ id: channels.id });

  let channelId: string;

  if (inserted) {
    channelId = inserted.id;
    logger.info('Channel auto-registered', { platform, externalId, channelId });
  } else {
    const [existing] = await db
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.platform, platform), eq(channels.externalId, externalId)));

    channelId = existing.id;
    logger.debug`Channel already existed during auto-register race: ${externalId}`;
  }

  enrichChannelName(platform, externalId, channelId);

  return { id: channelId, platform, externalId };
}

function enrichChannelName(platform: ChannelPlatform, externalId: string, channelId: string): void {
  PlatformRegistry.enrichChannelName(platform, externalId, channelId)
    .then(async (name) => {
      if (!name) return;
      const db = getDb();
      await db
        .update(channels)
        .set({ externalName: name, updatedAt: new Date() })
        .where(eq(channels.id, channelId));
      logger.debug`Enriched channel name: ${name} for ${channelId}`;
    })
    .catch((error: Error) => {
      logger.warn('Failed to enrich channel name', {
        platform,
        externalId,
        error: error.message,
      });
    });
}
