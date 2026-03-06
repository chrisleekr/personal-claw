import type { ChannelAdapter } from '../channels/adapter';

export interface ChannelRecord {
  id: string;
  platform: string;
  externalId: string;
}

export interface PlatformPlugin {
  readonly name: string;
  init(): Promise<void>;
  createAdapter(channel: ChannelRecord): ChannelAdapter;
  enrichChannelName?(externalId: string, channelId: string): Promise<string | null>;
  shutdown?(): Promise<void>;
}
