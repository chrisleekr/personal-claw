import { PlatformRegistry } from '../platforms/registry';
import type { ChannelRecord } from '../platforms/types';
import type { ChannelAdapter } from './adapter';

export function createChannelAdapter(channel: ChannelRecord): ChannelAdapter {
  return PlatformRegistry.createAdapter(channel);
}
