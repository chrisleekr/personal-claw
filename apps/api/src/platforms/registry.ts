import { getLogger } from '@logtape/logtape';
import type { ChannelAdapter } from '../channels/adapter';
import { NoOpAdapter } from '../channels/no-op-adapter';
import { errorDetails } from '../utils/error-fmt';
import type { ChannelRecord, PlatformPlugin } from './types';

const logger = getLogger(['personalclaw', 'platforms', 'registry']);

class PlatformRegistryImpl {
  private plugins = new Map<string, PlatformPlugin>();

  register(plugin: PlatformPlugin): void {
    this.plugins.set(plugin.name, plugin);
    logger.debug`Registered platform plugin: ${plugin.name}`;
  }

  get(name: string): PlatformPlugin | undefined {
    return this.plugins.get(name);
  }

  createAdapter(channel: ChannelRecord): ChannelAdapter {
    const plugin = this.plugins.get(channel.platform);
    if (!plugin) {
      logger.debug`No platform plugin for platform=${channel.platform}, using NoOpAdapter`;
      return new NoOpAdapter();
    }
    return plugin.createAdapter(channel);
  }

  async enrichChannelName(
    platform: string,
    externalId: string,
    channelId: string,
  ): Promise<string | null> {
    const plugin = this.plugins.get(platform);
    if (!plugin?.enrichChannelName) return null;
    return plugin.enrichChannelName(externalId, channelId);
  }

  async initAll(): Promise<void> {
    for (const [name, plugin] of this.plugins) {
      try {
        await plugin.init();
        logger.info`Platform initialized: ${name}`;
      } catch (error) {
        logger.warn('Platform initialization failed', { platform: name, ...errorDetails(error) });
      }
    }
  }

  async shutdownAll(): Promise<void> {
    for (const [name, plugin] of this.plugins) {
      try {
        await plugin.shutdown?.();
      } catch (error) {
        logger.warn('Platform shutdown failed', { platform: name, ...errorDetails(error) });
      }
    }
  }

  list(): string[] {
    return [...this.plugins.keys()];
  }
}

export const PlatformRegistry = new PlatformRegistryImpl();
