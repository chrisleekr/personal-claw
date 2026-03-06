import { channels, eq } from '@personalclaw/db';
import { z } from 'zod';
import { emitConfigChange } from '../config/hot-reload';
import { getDb } from '../db';
import { NotFoundError } from '../errors/app-error';

export const updateIdentitySchema = z.object({
  identityPrompt: z.string().optional(),
  teamPrompt: z.string().optional(),
  threadReplyMode: z.enum(['all', 'mentions_only', 'original_poster']).optional(),
  autonomyLevel: z.enum(['cautious', 'balanced', 'autonomous']).optional(),
});

export type UpdateIdentityInput = z.infer<typeof updateIdentitySchema>;

export class IdentityService {
  async getByChannel(channelId: string) {
    const db = getDb();
    const [row] = await db
      .select({
        identityPrompt: channels.identityPrompt,
        teamPrompt: channels.teamPrompt,
        threadReplyMode: channels.threadReplyMode,
        autonomyLevel: channels.autonomyLevel,
      })
      .from(channels)
      .where(eq(channels.id, channelId));
    if (!row) throw new NotFoundError('Channel', channelId);
    return row;
  }

  async update(channelId: string, input: UpdateIdentityInput) {
    const db = getDb();
    const [row] = await db
      .update(channels)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(channels.id, channelId))
      .returning({
        identityPrompt: channels.identityPrompt,
        teamPrompt: channels.teamPrompt,
        threadReplyMode: channels.threadReplyMode,
        autonomyLevel: channels.autonomyLevel,
      });
    if (!row) throw new NotFoundError('Channel', channelId);
    emitConfigChange(channelId, 'identity');
    return row;
  }
}
