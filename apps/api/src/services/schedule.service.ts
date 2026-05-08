import { eq, schedules } from '@personalclaw/db';
import type { CreateScheduleInput } from '@personalclaw/shared';
import { z } from 'zod';
import { emitConfigChange } from '../config/hot-reload';
import { getDb } from '../db';
import { NotFoundError } from '../errors/app-error';

export const updateScheduleSchema = z.object({
  name: z.string().min(1).optional(),
  cronExpression: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  notifyUsers: z.array(z.string()).optional(),
});

export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;

export class ScheduleService {
  async listByChannel(channelId: string) {
    const db = getDb();
    return db
      .select()
      .from(schedules)
      .where(eq(schedules.channelId, channelId))
      .orderBy(schedules.createdAt);
  }

  async create(input: CreateScheduleInput) {
    const db = getDb();
    const [row] = await db.insert(schedules).values(input).returning();
    emitConfigChange(input.channelId, 'schedules');
    return row;
  }

  async update(id: string, input: UpdateScheduleInput) {
    const db = getDb();
    const [row] = await db.update(schedules).set(input).where(eq(schedules.id, id)).returning();
    if (!row) throw new NotFoundError('Schedule', id);
    emitConfigChange(row.channelId, 'schedules');
    return row;
  }

  async delete(id: string) {
    const db = getDb();
    const [row] = await db.delete(schedules).where(eq(schedules.id, id)).returning();
    if (!row) throw new NotFoundError('Schedule', id);
    emitConfigChange(row.channelId, 'schedules');
  }

  async updateScoped(channelId: string, id: string, input: UpdateScheduleInput) {
    const db = getDb();
    const [existing] = await db.select().from(schedules).where(eq(schedules.id, id));
    if (!existing) throw new NotFoundError('Schedule', id);
    if (existing.channelId !== channelId) throw new NotFoundError('Schedule', id);
    return this.update(id, input);
  }

  async deleteScoped(channelId: string, id: string) {
    const db = getDb();
    const [existing] = await db.select().from(schedules).where(eq(schedules.id, id));
    if (!existing) throw new NotFoundError('Schedule', id);
    if (existing.channelId !== channelId) throw new NotFoundError('Schedule', id);
    return this.delete(id);
  }
}
