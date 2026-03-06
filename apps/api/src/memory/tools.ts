import { memorySaveSchema, memorySearchSchema } from '@personalclaw/shared';
import { tool } from 'ai';
import { z } from 'zod';
import { HooksEngine } from '../hooks/engine';
import { LongTermMemory } from './longterm';

const longTermMemory = new LongTermMemory();
const hooks = HooksEngine.getInstance();

export function getMemoryTools(channelId: string, userId = '', threadId = '') {
  return {
    memory_save: tool({
      description:
        'Save a durable fact, preference, or decision to long-term memory for this channel.',
      inputSchema: memorySaveSchema,
      execute: async ({ content, category }) => {
        await longTermMemory.save(channelId, content, category, threadId || undefined);
        await hooks.emit('memory:saved', {
          channelId,
          externalUserId: userId,
          threadId,
          eventType: 'memory:saved',
          payload: { content, category },
        });
        return { saved: true, content, category };
      },
    }),
    memory_search: tool({
      description: 'Search long-term memories for this channel by meaning or keyword.',
      inputSchema: memorySearchSchema,
      execute: async ({ query, limit }) => {
        const results = await longTermMemory.search(channelId, query, limit);
        return { results: results.map((m) => ({ content: m.content, category: m.category })) };
      },
    }),
    memory_list: tool({
      description: 'List all long-term memories for this channel.',
      inputSchema: z.object({}),
      execute: async () => {
        const memories = await longTermMemory.list(channelId);
        return {
          memories: memories.map((m) => ({
            content: m.content,
            category: m.category,
            recallCount: m.recallCount,
          })),
        };
      },
    }),
  };
}
