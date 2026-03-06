import { channelMemories, desc, eq } from '@personalclaw/db';
import type { UpdateMemoryInput } from '@personalclaw/shared';
import { getDb } from '../db';
import { NotFoundError } from '../errors/app-error';

export class MemoryService {
  async listByChannel(channelId: string) {
    const db = getDb();
    return db
      .select()
      .from(channelMemories)
      .where(eq(channelMemories.channelId, channelId))
      .orderBy(desc(channelMemories.recallCount))
      .limit(200);
  }

  async search(channelId: string, query: string) {
    const db = getDb();

    if (!query) {
      return this.listByChannel(channelId);
    }

    const rows = await db
      .select()
      .from(channelMemories)
      .where(eq(channelMemories.channelId, channelId))
      .orderBy(desc(channelMemories.recallCount))
      .limit(50);

    return rows.filter((r) => r.content.toLowerCase().includes(query.toLowerCase()));
  }

  async update(id: string, input: UpdateMemoryInput) {
    const db = getDb();
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (input.content !== undefined) updates.content = input.content;
    if (input.category !== undefined) updates.category = input.category;

    const [row] = await db
      .update(channelMemories)
      .set(updates)
      .where(eq(channelMemories.id, id))
      .returning();
    if (!row) throw new NotFoundError('Memory', id);
    return row;
  }

  async delete(id: string) {
    const db = getDb();
    const [row] = await db.delete(channelMemories).where(eq(channelMemories.id, id)).returning();
    if (!row) throw new NotFoundError('Memory', id);
  }
}
