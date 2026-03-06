import { channels, eq } from '@personalclaw/db';
import type { CreateChannelInput, UpdateChannelInput } from '@personalclaw/shared';
import { invalidateConfig } from '../channels/config-cache';
import { getDb } from '../db';
import { NotFoundError } from '../errors/app-error';

function coerceBudget<T extends { costBudgetDailyUsd?: number | null }>(
  input: T,
): Omit<T, 'costBudgetDailyUsd'> & { costBudgetDailyUsd?: string | null } {
  const { costBudgetDailyUsd, ...rest } = input;
  return {
    ...rest,
    ...(costBudgetDailyUsd !== undefined && {
      costBudgetDailyUsd: costBudgetDailyUsd != null ? String(costBudgetDailyUsd) : null,
    }),
  } as Omit<T, 'costBudgetDailyUsd'> & { costBudgetDailyUsd?: string | null };
}

export class ChannelService {
  async list() {
    const db = getDb();
    return db.select().from(channels).orderBy(channels.createdAt);
  }

  async getById(id: string) {
    const db = getDb();
    const [row] = await db.select().from(channels).where(eq(channels.id, id));
    if (!row) throw new NotFoundError('Channel', id);
    return row;
  }

  async create(input: CreateChannelInput) {
    const db = getDb();
    const [row] = await db.insert(channels).values(coerceBudget(input)).returning();
    return row;
  }

  async update(id: string, input: UpdateChannelInput) {
    const db = getDb();
    const [row] = await db
      .update(channels)
      .set({ ...coerceBudget(input), updatedAt: new Date() })
      .where(eq(channels.id, id))
      .returning();
    if (!row) throw new NotFoundError('Channel', id);
    invalidateConfig(id);
    return row;
  }

  async delete(id: string) {
    const db = getDb();
    const [row] = await db.delete(channels).where(eq(channels.id, id)).returning();
    if (!row) throw new NotFoundError('Channel', id);
    invalidateConfig(id);
  }
}
