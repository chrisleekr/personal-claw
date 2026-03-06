import { getLogger } from '@logtape/logtape';
import { eq, skills } from '@personalclaw/db';
import { getDb } from '../db';
import { errorDetails } from '../utils/error-fmt';

const logger = getLogger(['personalclaw', 'skills', 'loader']);

export interface LoadedSkill {
  id: string;
  content: string;
}

export class SkillsLoader {
  private skillCache = new Map<string, LoadedSkill[]>();

  async loadForChannel(channelId: string): Promise<LoadedSkill[]> {
    const cached = this.skillCache.get(channelId);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const db = getDb();
      const rows = await db
        .select({ id: skills.id, content: skills.content })
        .from(skills)
        .where(eq(skills.channelId, channelId));

      const loaded = rows
        .filter((r) => r.content.length > 0)
        .map((r) => ({ id: r.id, content: r.content }));

      this.skillCache.set(channelId, loaded);
      return loaded;
    } catch (error) {
      logger.error('Failed to load skills', { channelId, ...errorDetails(error) });
      return [];
    }
  }

  invalidateChannel(channelId: string): void {
    this.skillCache.delete(channelId);
  }

  invalidateAll(): void {
    this.skillCache.clear();
  }
}
