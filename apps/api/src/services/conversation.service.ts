import { conversations, desc, eq, sql } from '@personalclaw/db';
import { getDb } from '../db';
import { NotFoundError } from '../errors/app-error';

export class ConversationService {
  async listByChannel(channelId: string) {
    const db = getDb();
    return db
      .select({
        id: conversations.id,
        channelId: conversations.channelId,
        externalThreadId: conversations.externalThreadId,
        firstMessage: sql<string | null>`(
          SELECT elem->>'content'
          FROM jsonb_array_elements(${conversations.messages}) AS elem
          WHERE elem->>'role' = 'user'
          LIMIT 1
        )`.as('first_message'),
        messageCount: sql<number>`jsonb_array_length(${conversations.messages})`.as(
          'message_count',
        ),
        summary: conversations.summary,
        isCompacted: conversations.isCompacted,
        tokenCount: conversations.tokenCount,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .where(eq(conversations.channelId, channelId))
      .orderBy(desc(conversations.updatedAt))
      .limit(100);
  }

  async getById(channelId: string, id: string) {
    const db = getDb();
    const [row] = await db.select().from(conversations).where(eq(conversations.id, id));

    if (!row) throw new NotFoundError('Conversation', id);
    if (row.channelId !== channelId) throw new NotFoundError('Conversation', id);

    return row;
  }
}
