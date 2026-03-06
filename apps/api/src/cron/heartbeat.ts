import { getLogger } from '@logtape/logtape';
import { channels, eq } from '@personalclaw/db';
import cron from 'node-cron';
import { createChannelAdapter } from '../channels/adapter-factory';
import { getDb } from '../db';
import { errorDetails } from '../utils/error-fmt';

const logger = getLogger(['personalclaw', 'cron', 'heartbeat']);

const heartbeatTasks = new Map<string, cron.ScheduledTask>();

export async function runHeartbeat(channelId: string): Promise<void> {
  try {
    const db = getDb();
    const [channel] = await db
      .select({
        id: channels.id,
        platform: channels.platform,
        externalId: channels.externalId,
        heartbeatPrompt: channels.heartbeatPrompt,
        heartbeatEnabled: channels.heartbeatEnabled,
      })
      .from(channels)
      .where(eq(channels.id, channelId));

    if (!channel?.heartbeatEnabled || !channel.heartbeatPrompt) return;

    const adapter = createChannelAdapter(channel);
    const threadId = `heartbeat-${Date.now()}`;

    const { AgentEngine } = await import('../agent/engine');
    const engine = await AgentEngine.create();
    const result = await engine.run({
      channelId,
      threadId,
      userId: 'system',
      text: channel.heartbeatPrompt,
      adapter,
    });

    if (result.text) {
      await adapter.sendMessage(threadId, result.text);
    }

    logger.info`Heartbeat completed for channel=${channelId} result=${result.text.slice(0, 100)}`;
  } catch (error) {
    logger.error('Heartbeat failed', { channelId, ...errorDetails(error) });
  }
}

export async function initHeartbeats(): Promise<void> {
  for (const [, task] of heartbeatTasks) {
    task.stop();
  }
  heartbeatTasks.clear();

  try {
    const db = getDb();
    const rows = await db
      .select({
        id: channels.id,
        heartbeatCron: channels.heartbeatCron,
        heartbeatEnabled: channels.heartbeatEnabled,
      })
      .from(channels)
      .where(eq(channels.heartbeatEnabled, true));

    for (const channel of rows) {
      if (!cron.validate(channel.heartbeatCron)) continue;

      const task = cron.schedule(channel.heartbeatCron, () => {
        runHeartbeat(channel.id);
      });

      heartbeatTasks.set(channel.id, task);
    }

    logger.info`Registered ${heartbeatTasks.size} heartbeat monitors`;
  } catch (error) {
    logger.error('Failed to initialize heartbeats', errorDetails(error));
  }
}
