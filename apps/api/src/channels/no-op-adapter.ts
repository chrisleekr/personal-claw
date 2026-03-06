import type { ChannelAdapter } from './adapter';

/**
 * No-op adapter used when the channel's platform client is unavailable
 * or when message delivery is intentionally disabled (e.g. dry-run mode).
 *
 * All approval requests are auto-approved so agent execution continues
 * uninterrupted; messages are silently discarded.
 */
export class NoOpAdapter implements ChannelAdapter {
  async sendMessage(): Promise<void> {}

  async requestApproval(): Promise<boolean> {
    return true;
  }

  async requestPlanApproval(): Promise<boolean> {
    return true;
  }
}
