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
    const incomingTokenCount = estimateTokenCount(messages.map((m) => m.content).join(' '));

    // Atomic upsert: if a row already exists for (channelId, externalThreadId)
    // the new messages are appended via JSONB concat in SQL, eliminating the
    // read-modify-write race that previously dropped concurrent writes.
    // The token_count returned by RETURNING reflects either the just-inserted
    // row (no merge needed) or the prior count plus the incoming estimate
    // (sufficient for compaction triggers; a follow-up UPDATE inside the same
    // transaction recomputes the exact estimate from the merged messages).
    return db.transaction(async (tx) => {
      const [row] = await tx
        .insert(conversations)
        .values({
          channelId,
          externalThreadId: threadId,
          messages: messages as unknown as Record<string, unknown>[],
          tokenCount: incomingTokenCount,
        })
        .onConflictDoUpdate({
          target: [conversations.channelId, conversations.externalThreadId],
          set: {
            messages: sql`${conversations.messages} || ${JSON.stringify(messages)}::jsonb`,
            updatedAt: new Date(),
          },
        })
        .returning();

      const mergedMessages = (row?.messages as ConversationMessage[]) ?? messages;
      const allText = mergedMessages.map((m) => m.content).join(' ');
      const tokenCount = estimateTokenCount(allText);

      if (row && tokenCount !== row.tokenCount) {
        await tx.update(conversations).set({ tokenCount }).where(eq(conversations.id, row.id));
      }

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
