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

    return (row.messages as ConversationMessage[]) ?? [];
  }

  async append(
    channelId: string,
    threadId: string,
    ...messages: ConversationMessage[]
  ): Promise<{ tokenCount: number }> {
    const db = getDb();

    const [existing] = await db
      .select()
      .from(conversations)
      .where(
        and(eq(conversations.channelId, channelId), eq(conversations.externalThreadId, threadId)),
      );

    if (existing) {
      const currentMessages = (existing.messages as ConversationMessage[]) ?? [];
      const updatedMessages = [...currentMessages, ...messages];
      const allText = updatedMessages.map((m) => m.content).join(' ');
      const tokenCount = estimateTokenCount(allText);

      await db
        .update(conversations)
        .set({
          messages: updatedMessages as unknown as Record<string, unknown>[],
          tokenCount,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, existing.id));

      return { tokenCount };
    }

    const allText = messages.map((m) => m.content).join(' ');
    const tokenCount = estimateTokenCount(allText);

    await db.insert(conversations).values({
      channelId,
      externalThreadId: threadId,
      messages: messages as unknown as Record<string, unknown>[],
      tokenCount,
    });

    return { tokenCount };
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
