import { and, eq, schedules } from '@personalclaw/db';
import { tool } from 'ai';
import { z } from 'zod';
import { emitConfigChange } from '../config/hot-reload';
import { getDb } from '../db';

export function getScheduleTools(channelId: string) {
  return {
    schedule_list: tool({
      description:
        'List all scheduled tasks for this channel. ' +
        'Each schedule runs a prompt on a cron expression (e.g. daily reports, reminders).',
      inputSchema: z.object({}),
      execute: async () => {
        const db = getDb();
        const rows = await db
          .select()
          .from(schedules)
          .where(eq(schedules.channelId, channelId))
          .orderBy(schedules.createdAt);
        return {
          schedules: rows.map((r) => ({
            id: r.id,
            name: r.name,
            cronExpression: r.cronExpression,
            prompt: r.prompt,
            enabled: r.enabled,
            lastRunAt: r.lastRunAt?.toISOString() ?? null,
          })),
        };
      },
    }),

    schedule_create: tool({
      description:
        'Create a new scheduled task for this channel. ' +
        'The prompt will be executed on the given cron schedule. ' +
        'Examples: "0 9 * * 1-5" (weekdays 9 AM), "0 */6 * * *" (every 6 hours).',
      inputSchema: z.object({
        name: z.string().min(1).describe('Human-readable name for the schedule'),
        cronExpression: z
          .string()
          .min(1)
          .describe('Cron expression (5-field: minute hour day month weekday)'),
        prompt: z.string().min(1).describe('The prompt to execute on each run'),
        enabled: z.boolean().default(true).describe('Whether the schedule is active'),
      }),
      execute: async ({ name, cronExpression, prompt, enabled }) => {
        const db = getDb();
        const [row] = await db
          .insert(schedules)
          .values({ channelId, name, cronExpression, prompt, enabled })
          .returning();
        emitConfigChange(channelId, 'schedules');
        return {
          created: true,
          schedule: {
            id: row.id,
            name: row.name,
            cronExpression: row.cronExpression,
            prompt: row.prompt,
            enabled: row.enabled,
          },
        };
      },
    }),

    schedule_update: tool({
      description:
        'Update an existing scheduled task. Use this to enable/disable, change the cron expression, or modify the prompt.',
      inputSchema: z.object({
        id: z.string().uuid().describe('The schedule ID to update'),
        name: z.string().min(1).optional().describe('New name'),
        cronExpression: z.string().min(1).optional().describe('New cron expression'),
        prompt: z.string().min(1).optional().describe('New prompt'),
        enabled: z.boolean().optional().describe('Enable or disable the schedule'),
      }),
      execute: async ({ id, ...updates }) => {
        const db = getDb();
        const [row] = await db
          .update(schedules)
          .set(updates)
          .where(and(eq(schedules.id, id), eq(schedules.channelId, channelId)))
          .returning();
        if (!row) {
          return { error: true, message: 'Schedule not found in this channel' };
        }
        emitConfigChange(channelId, 'schedules');
        return {
          updated: true,
          schedule: {
            id: row.id,
            name: row.name,
            cronExpression: row.cronExpression,
            prompt: row.prompt,
            enabled: row.enabled,
          },
        };
      },
    }),

    schedule_delete: tool({
      description: 'Delete a scheduled task by ID.',
      inputSchema: z.object({
        id: z.string().uuid().describe('The schedule ID to delete'),
      }),
      execute: async ({ id }) => {
        const db = getDb();
        const [row] = await db
          .delete(schedules)
          .where(and(eq(schedules.id, id), eq(schedules.channelId, channelId)))
          .returning();
        if (!row) {
          return { error: true, message: 'Schedule not found in this channel' };
        }
        emitConfigChange(channelId, 'schedules');
        return { deleted: true, name: row.name };
      },
    }),
  };
}
