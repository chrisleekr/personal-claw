import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

let mockSpawnResult = 'task-123';
let mockSubtaskResult: { taskId: string; text: string; status: string; durationMs: number } | null =
  null;

mock.module('../sub-agents', () => ({
  spawnSubtask: async () => mockSpawnResult,
  getSubtaskResult: async () => mockSubtaskResult,
}));

import { getSubAgentTools } from '../sub-agent-tools';

describe('getSubAgentTools', () => {
  const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';

  beforeEach(() => {
    mockSpawnResult = 'task-123';
    mockSubtaskResult = null;
  });

  afterEach(() => {
    mockSpawnResult = 'task-123';
    mockSubtaskResult = null;
  });

  test('returns spawn_subtask and get_subtask_result tools', () => {
    const tools = getSubAgentTools(CHANNEL_ID);
    expect(tools.spawn_subtask).toBeDefined();
    expect(tools.get_subtask_result).toBeDefined();
  });

  test('spawn_subtask returns taskId and spawned status', async () => {
    const tools = getSubAgentTools(CHANNEL_ID);
    const result = await tools.spawn_subtask.execute(
      { instruction: 'Analyze this code', timeoutMs: 30000 },
      { toolCallId: 'tc-1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(result.taskId).toBe('task-123');
    expect(result.status).toBe('spawned');
  });

  test('get_subtask_result returns pending when task not complete', async () => {
    mockSubtaskResult = null;
    const tools = getSubAgentTools(CHANNEL_ID);
    const result = await tools.get_subtask_result.execute(
      { taskId: 'task-123' },
      { toolCallId: 'tc-2', messages: [], abortSignal: new AbortController().signal },
    );
    expect(result.status).toBe('pending');
  });

  test('get_subtask_result returns completed result', async () => {
    mockSubtaskResult = {
      taskId: 'task-123',
      text: 'Analysis complete',
      status: 'completed',
      durationMs: 5000,
    };
    const tools = getSubAgentTools(CHANNEL_ID);
    const result = await tools.get_subtask_result.execute(
      { taskId: 'task-123' },
      { toolCallId: 'tc-3', messages: [], abortSignal: new AbortController().signal },
    );
    expect(result.status).toBe('completed');
    expect(result.text).toBe('Analysis complete');
  });
});
