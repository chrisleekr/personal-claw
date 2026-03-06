import { getLogger } from '@logtape/logtape';
import { channelMemories, desc, eq, inArray, sql } from '@personalclaw/db';
import type { ChannelMemory, MemoryCategory } from '@personalclaw/shared';
import { memoryCategorySchema } from '@personalclaw/shared';
import { getDb } from '../db';
import { errorDetails } from '../utils/error-fmt';
import { generateEmbedding } from './embeddings';

const logger = getLogger(['personalclaw', 'memory', 'longterm']);

export class LongTermMemory {
  async save(
    channelId: string,
    content: string,
    category: MemoryCategory,
    sourceThreadId?: string,
  ): Promise<void> {
    const db = getDb();

    let embedding: number[] | null = null;
    try {
      embedding = await generateEmbedding(content);
    } catch (error) {
      logger.warn('Embedding generation failed, saving without vector', {
        channelId,
        ...errorDetails(error),
      });
    }

    await db.insert(channelMemories).values({
      channelId,
      content,
      category,
      sourceThreadId: sourceThreadId ?? null,
      ...(embedding ? { embedding: sql`${JSON.stringify(embedding)}::vector` } : {}),
    } as typeof channelMemories.$inferInsert);
  }

  async search(channelId: string, query: string, limit = 10): Promise<ChannelMemory[]> {
    const db = getDb();

    let vectorResults: ChannelMemory[] = [];
    try {
      const queryEmbedding = await generateEmbedding(query);
      const vectorRows = await db.execute(sql`
        SELECT id, channel_id, content, category, source_thread_id,
               recall_count, last_recalled_at, created_at, updated_at,
               1 - (embedding <=> ${JSON.stringify(queryEmbedding)}::vector) as similarity
        FROM channel_memories
        WHERE channel_id = ${channelId}
          AND embedding IS NOT NULL
        ORDER BY embedding <=> ${JSON.stringify(queryEmbedding)}::vector
        LIMIT ${limit}
      `);
      vectorResults = (Array.isArray(vectorRows) ? vectorRows : []) as unknown as ChannelMemory[];
    } catch (error) {
      logger.warn('Vector search failed', { channelId, ...errorDetails(error) });
    }

    let keywordResults: ChannelMemory[] = [];
    try {
      const keywordRows = await db.execute(sql`
        SELECT id, channel_id, content, category, source_thread_id,
               recall_count, last_recalled_at, created_at, updated_at,
               ts_rank(search_vector, plainto_tsquery('english', ${query})) as rank
        FROM channel_memories
        WHERE channel_id = ${channelId}
          AND search_vector @@ plainto_tsquery('english', ${query})
        ORDER BY rank DESC
        LIMIT ${limit}
      `);
      keywordResults = (Array.isArray(keywordRows)
        ? keywordRows
        : []) as unknown as ChannelMemory[];
    } catch (error) {
      logger.warn('Keyword search failed', { channelId, ...errorDetails(error) });
    }

    const seen = new Set<string>();
    const merged: ChannelMemory[] = [];

    for (const row of [...vectorResults, ...keywordResults]) {
      const id = (row as unknown as Record<string, unknown>).id as string;
      if (!seen.has(id)) {
        seen.add(id);
        merged.push(this.normalizeRow(row));
      }
    }

    return merged.slice(0, limit);
  }

  async list(channelId: string): Promise<ChannelMemory[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(channelMemories)
      .where(eq(channelMemories.channelId, channelId))
      .orderBy(desc(channelMemories.recallCount))
      .limit(200);

    return rows.map((r) => {
      const parsed = memoryCategorySchema.safeParse(r.category);
      return {
        id: r.id,
        channelId: r.channelId,
        content: r.content,
        category: parsed.success ? parsed.data : ('fact' as MemoryCategory),
        sourceThreadId: r.sourceThreadId,
        recallCount: r.recallCount,
        lastRecalledAt: r.lastRecalledAt,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    });
  }

  async incrementRecall(memoryIds: string[]): Promise<void> {
    if (memoryIds.length === 0) return;
    const db = getDb();

    await db
      .update(channelMemories)
      .set({
        recallCount: sql`${channelMemories.recallCount} + 1`,
        lastRecalledAt: new Date(),
      })
      .where(inArray(channelMemories.id, memoryIds));
  }

  private normalizeRow(row: unknown): ChannelMemory {
    const r = row as Record<string, unknown>;
    const parsed = memoryCategorySchema.safeParse(r.category);
    return {
      id: r.id as string,
      channelId: (r.channel_id ?? r.channelId) as string,
      content: r.content as string,
      category: parsed.success ? parsed.data : ('fact' as MemoryCategory),
      sourceThreadId: (r.source_thread_id ?? r.sourceThreadId ?? null) as string | null,
      recallCount: Number(r.recall_count ?? r.recallCount ?? 0),
      lastRecalledAt: (r.last_recalled_at ?? r.lastRecalledAt ?? null) as Date | null,
      createdAt: (r.created_at ?? r.createdAt) as Date,
      updatedAt: (r.updated_at ?? r.updatedAt) as Date,
    };
  }
}
