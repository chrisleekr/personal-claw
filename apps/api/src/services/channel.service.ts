import { channels, eq } from '@personalclaw/db';
import type { CreateChannelInput, UpdateChannelInput } from '@personalclaw/shared';
import { invalidateConfig } from '../channels/config-cache';
import { getDb } from '../db';
import { NotFoundError } from '../errors/app-error';

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
    const [row] = await db.insert(channels).values(input).returning();
    return row;
  }

  async update(id: string, input: UpdateChannelInput) {
    const db = getDb();
    const [row] = await db
      .update(channels)
      .set({ ...input, updatedAt: new Date() })
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
