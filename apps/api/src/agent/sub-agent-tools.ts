import { tool } from 'ai';
import { z } from 'zod';
import { getSubtaskResult, spawnSubtask } from './sub-agents';

export function getSubAgentTools(channelId: string) {
  return {
    spawn_subtask: tool({
      description:
        'Spawn a parallel background subtask with its own LLM call. ' +
        'Returns a task ID you can poll with get_subtask_result. ' +
        'Use for independent investigation or analysis that can run concurrently.',
      inputSchema: z.object({
        instruction: z.string().describe('What the subtask should do'),
        timeoutMs: z
          .number()
          .int()
          .min(5000)
          .max(120000)
          .default(30000)
          .describe('Max time in ms before the subtask is terminated'),
      }),
      execute: async ({ instruction, timeoutMs }) => {
        const taskId = await spawnSubtask({ channelId, instruction, timeoutMs });
        return { taskId, status: 'spawned' as const };
      },
    }),

    get_subtask_result: tool({
      description:
        'Check the result of a previously spawned subtask by its task ID. ' +
        'Returns status "pending" if the subtask is still running.',
      inputSchema: z.object({
        taskId: z.string().describe('The task ID returned by spawn_subtask'),
      }),
      execute: async ({ taskId }) => {
        const result = await getSubtaskResult(taskId);
        if (!result) return { taskId, status: 'pending' as const };
        return result;
      },
    }),
  };
}
