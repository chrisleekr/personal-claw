import { getLogger } from '@logtape/logtape';
import { channels, eq, schedules } from '@personalclaw/db';
import cron from 'node-cron';
import { createChannelAdapter } from '../channels/adapter-factory';
import { onConfigChange } from '../config/hot-reload';
import { getDb } from '../db';
import { errorDetails } from '../utils/error-fmt';

const logger = getLogger(['personalclaw', 'cron', 'runner']);

const activeTasks = new Map<string, cron.ScheduledTask>();

async function loadAndRegisterSchedules(): Promise<void> {
  for (const [, task] of activeTasks) {
    task.stop();
  }
  activeTasks.clear();

  try {
    const db = getDb();
    const rows = await db.select().from(schedules).where(eq(schedules.enabled, true));

    for (const schedule of rows) {
      if (!cron.validate(schedule.cronExpression)) {
        logger.warn`Invalid cron expression for schedule "${schedule.name}": ${schedule.cronExpression}`;
        continue;
      }

      const task = cron.schedule(schedule.cronExpression, async () => {
        logger.info`Running schedule "${schedule.name}" for channel=${schedule.channelId}`;
        try {
          const db = getDb();

          const [channel] = await db
            .select({
              id: channels.id,
              platform: channels.platform,
              externalId: channels.externalId,
            })
            .from(channels)
            .where(eq(channels.id, schedule.channelId));

          if (!channel) {
            logger.error('Channel not found for schedule', {
              scheduleId: schedule.id,
              channelId: schedule.channelId,
            });
            return;
          }

          const adapter = createChannelAdapter(channel);
          const threadId = `cron-${schedule.id}-${Date.now()}`;

          const { AgentEngine } = await import('../agent/engine');
          const engine = await AgentEngine.create();
          const result = await engine.run({
            channelId: schedule.channelId,
            threadId,
            userId: 'system',
            text: schedule.prompt,
            adapter,
          });

          if (result.text) {
            let messageText = result.text;
            if (schedule.notifyUsers.length > 0 && adapter.formatMentions) {
              messageText = `${adapter.formatMentions(schedule.notifyUsers)}\n${messageText}`;
            }
            await adapter.sendMessage(threadId, messageText);
          }

          await db
            .update(schedules)
            .set({ lastRunAt: new Date() })
            .where(eq(schedules.id, schedule.id));
        } catch (error) {
          logger.error('Schedule execution failed', {
            scheduleName: schedule.name,
            scheduleId: schedule.id,
            channelId: schedule.channelId,
            ...errorDetails(error),
          });
        }
      });

      activeTasks.set(schedule.id, task);
    }

    logger.info`Registered ${activeTasks.size} scheduled jobs`;
  } catch (error) {
    logger.error('Failed to load schedules', errorDetails(error));
  }
}

export function initCronRunner(): void {
  loadAndRegisterSchedules();

  onConfigChange((channelId, changeType) => {
    if (changeType === 'schedules') {
      logger.info`Reloading schedules after config change for channel=${channelId}`;
      loadAndRegisterSchedules();
    }
  });

  logger.info`Cron runner initialized`;
}
