import { eq, skills, skillUsages, sql } from '@personalclaw/db';
import type { CreateSkillInput, UpdateSkillInput } from '@personalclaw/shared';
import { emitConfigChange } from '../config/hot-reload';
import { getDb } from '../db';
import { NotFoundError } from '../errors/app-error';

export class SkillService {
  async listByChannel(channelId: string) {
    const db = getDb();
    return db
      .select()
      .from(skills)
      .where(eq(skills.channelId, channelId))
      .orderBy(skills.createdAt);
  }

  async getStats(channelId: string) {
    const db = getDb();
    return db
      .select({
        skillId: skillUsages.skillId,
        usageCount: sql<number>`count(*)::int`.as('usage_count'),
      })
      .from(skillUsages)
      .where(eq(skillUsages.channelId, channelId))
      .groupBy(skillUsages.skillId);
  }

  async create(input: CreateSkillInput) {
    const db = getDb();
    const [row] = await db.insert(skills).values(input).returning();
    emitConfigChange(input.channelId, 'skills');
    return row;
  }

  async update(id: string, input: UpdateSkillInput) {
    const db = getDb();
    const [row] = await db.update(skills).set(input).where(eq(skills.id, id)).returning();
    if (!row) throw new NotFoundError('Skill', id);
    emitConfigChange(row.channelId, 'skills');
    return row;
  }

  async delete(id: string) {
    const db = getDb();
    const [row] = await db.delete(skills).where(eq(skills.id, id)).returning();
    if (!row) throw new NotFoundError('Skill', id);
    emitConfigChange(row.channelId, 'skills');
  }
}
