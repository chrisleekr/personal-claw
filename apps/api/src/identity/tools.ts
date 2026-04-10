import { getLogger } from '@logtape/logtape';
import { channels, eq } from '@personalclaw/db';
import { tool } from 'ai';
import { z } from 'zod';
import { emitConfigChange } from '../config/hot-reload';
import { getDb } from '../db';
import { HooksEngine } from '../hooks/engine';
import { errorDetails } from '../utils/error-fmt';

const logger = getLogger(['personalclaw', 'identity', 'tools']);
const hooks = HooksEngine.getInstance();

export function getIdentityTools(channelId: string, userId = '', threadId = '') {
  return {
    identity_get: tool({
      description: 'Read the current identity prompt and team context for this channel.',
      inputSchema: z.object({}),
      execute: async () => {
        const db = getDb();
        const [row] = await db
          .select({
            identityPrompt: channels.identityPrompt,
            teamPrompt: channels.teamPrompt,
          })
          .from(channels)
          .where(eq(channels.id, channelId));

        if (!row) {
          return { error: true, message: 'Channel not found' };
        }

        return {
          identityPrompt: row.identityPrompt ?? '',
          teamPrompt: row.teamPrompt ?? '',
        };
      },
    }),

    identity_set: tool({
      description:
        'Update the identity prompt for this channel. ' +
        'Use when the user explicitly asks you to change your name, personality, role, or behavior. ' +
        'Always read current identity first with identity_get.',
      inputSchema: z.object({
        identityPrompt: z.string().describe('The complete new identity prompt'),
      }),
      execute: async ({ identityPrompt }) => {
        try {
          const db = getDb();
          const [row] = await db
            .update(channels)
            .set({ identityPrompt, updatedAt: new Date() })
            .where(eq(channels.id, channelId))
            .returning({ identityPrompt: channels.identityPrompt });

          if (!row) {
            return { error: true, message: 'Channel not found' };
          }

          emitConfigChange(channelId, 'identity');
          // Lifecycle notification; non-audit-critical. Discard HookEmitResult per FR-029.
          void (await hooks.emit('identity:updated', {
            channelId,
            externalUserId: userId,
            threadId,
            eventType: 'identity:updated',
            payload: { field: 'identityPrompt', value: identityPrompt },
          }));

          logger.info('Identity prompt updated', { channelId, userId });
          return { updated: true, identityPrompt: row.identityPrompt };
        } catch (error) {
          logger.error('Failed to update identity prompt', {
            channelId,
            ...errorDetails(error),
          });
          return { error: true, message: 'Failed to update identity prompt' };
        }
      },
    }),

    team_context_set: tool({
      description:
        'Update the team context for this channel. ' +
        'Use to store organizational knowledge: team members, projects, conventions, workflows. ' +
        'Always read current context first with identity_get, then merge new info.',
      inputSchema: z.object({
        teamPrompt: z.string().describe('The complete updated team context'),
      }),
      execute: async ({ teamPrompt }) => {
        try {
          const db = getDb();
          const [row] = await db
            .update(channels)
            .set({ teamPrompt, updatedAt: new Date() })
            .where(eq(channels.id, channelId))
            .returning({ teamPrompt: channels.teamPrompt });

          if (!row) {
            return { error: true, message: 'Channel not found' };
          }

          emitConfigChange(channelId, 'identity');
          // Lifecycle notification; non-audit-critical. Discard HookEmitResult per FR-029.
          void (await hooks.emit('identity:updated', {
            channelId,
            externalUserId: userId,
            threadId,
            eventType: 'identity:updated',
            payload: { field: 'teamPrompt', value: teamPrompt },
          }));

          logger.info('Team context updated', { channelId, userId });
          return { updated: true, teamPrompt: row.teamPrompt };
        } catch (error) {
          logger.error('Failed to update team context', {
            channelId,
            ...errorDetails(error),
          });
          return { error: true, message: 'Failed to update team context' };
        }
      },
    }),
  };
}
