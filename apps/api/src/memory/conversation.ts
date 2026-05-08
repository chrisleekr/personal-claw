import { and, conversations, eq, sql } from '@personalclaw/db';
import type { ConversationMessage } from '@personalclaw/shared';
import { estimateTokenCount } from '../agent/compaction';
import { getDb } from '../db';

export class ConversationMemory {
  async getHistory(channelId: string, threadId: string): Promise<ConversationMessage[]> {
    const db = getDb();
    const [row] = await db
      .select()
      .from(conversations)
      .where(
        and(eq(conversations.channelId, channelId), eq(conversations.externalThreadId, threadId)),
      );

    if (!row) return [];

    if (row.isCompacted && row.summary) {
      return [
        {
          role: 'system',
          content: `Previous conversation summary: ${row.summary}`,
          timestamp: new Date().toISOString(),
        },
      ];
    }

    return row.messages ?? [];
  }

  async append(
    channelId: string,
    threadId: string,
    ...messages: ConversationMessage[]
  ): Promise<{ tokenCount: number }> {
    const db = getDb();
    const initialText = messages.map((m) => m.content).join(' ');
    const initialTokenCount = estimateTokenCount(initialText);

    return await db.transaction(async (tx) => {
      // Atomic INSERT … ON CONFLICT DO UPDATE: when a row already exists for
      // (channel_id, external_thread_id), Postgres concatenates the existing
      // messages with the new ones in a single statement under a row-level
      // lock, eliminating the read-modify-write race. `xmax` in RETURNING
      // distinguishes the no-conflict insert path (xmax = '0') from the
      // update path so we can skip the redundant token_count rewrite when
      // the VALUES clause already wrote the correct count.
      const [row] = await tx
        .insert(conversations)
        .values({
          channelId,
          externalThreadId: threadId,
          messages,
          tokenCount: initialTokenCount,
        })
        .onConflictDoUpdate({
          target: [conversations.channelId, conversations.externalThreadId],
          set: {
            messages: sql`${conversations.messages} || EXCLUDED.messages`,
            updatedAt: new Date(),
          },
        })
        .returning({
          messages: conversations.messages,
          xmax: sql<string>`xmax::text`,
        });

      const mergedMessages = row?.messages ?? [];
      const isInsertPath = row?.xmax === '0';
      if (isInsertPath) {
        return { tokenCount: initialTokenCount };
      }

      const allText = mergedMessages.map((m) => m.content).join(' ');
      const tokenCount = estimateTokenCount(allText);

      // Conflict path: recompute token_count from the merged messages so
      // concurrent appends don't leave it referring to only one writer's
      // contribution.
      await tx
        .update(conversations)
        .set({ tokenCount })
        .where(
          and(eq(conversations.channelId, channelId), eq(conversations.externalThreadId, threadId)),
        );

      return { tokenCount };
    });
  }

  async compact(channelId: string, threadId: string, summary: string): Promise<void> {
    const db = getDb();

    await db
      .update(conversations)
      .set({
        summary,
        isCompacted: true,
        messages: sql`'[]'::jsonb`,
        tokenCount: estimateTokenCount(summary),
        updatedAt: new Date(),
      })
      .where(
        and(eq(conversations.channelId, channelId), eq(conversations.externalThreadId, threadId)),
      );
  }
}
