import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const mockGenerateText = mock(() => Promise.resolve({ text: 'Subtask completed' }));

mock.module('ai', () => ({
  generateText: mockGenerateText,
  stepCountIs: () => ({}),
}));

mock.module('../../channels/config-cache', () => ({
  getCachedConfig: async () => null,
}));

mock.module('../../config', () => ({
  config: {
    LLM_PROVIDER: 'anthropic',
  },
}));

mock.module('../providers/registry', () => ({
  getProviderRegistry: () => ({
    resolve: (_name: string, model?: string) => ({
      model: { modelId: model ?? 'default-model' },
      modelId: model ?? 'default-model',
    }),
    has: () => true,
  }),
}));

let mockRedisAvailable = false;
const mockRedisSet = mock(() => Promise.resolve('OK'));
const mockRedisGet = mock(() => Promise.resolve(null));

mock.module('../../redis', () => ({
  isRedisAvailable: () => mockRedisAvailable,
  getRedis: () => ({
    set: mockRedisSet,
    get: mockRedisGet,
  }),
}));

import { getSubtaskResult, spawnSubtask } from '../sub-agents';

describe('spawnSubtask', () => {
  beforeEach(() => {
    mockRedisAvailable = false;
    mockGenerateText.mockClear();
    mockRedisSet.mockClear();
    mockRedisGet.mockClear();
  });

  afterEach(() => {
    mockRedisAvailable = false;
  });

  test('returns a task ID immediately', async () => {
    const taskId = await spawnSubtask({
      channelId: 'ch-001',
      instruction: 'Analyze this',
    });

    expect(typeof taskId).toBe('string');
    expect(taskId.length).toBeGreaterThan(0);
  });

  test('returns unique IDs for each spawn', async () => {
    const id1 = await spawnSubtask({
      channelId: 'ch-001',
      instruction: 'Task A',
    });
    const id2 = await spawnSubtask({
      channelId: 'ch-001',
      instruction: 'Task B',
    });

    expect(id1).not.toBe(id2);
  });

  test('stores completed result in memory fallback', async () => {
    const taskId = await spawnSubtask({
      channelId: 'ch-001',
      instruction: 'Do something',
    });

    await Bun.sleep(100);

    const result = await getSubtaskResult(taskId);
    expect(result).not.toBeNull();
    expect(result?.status).toBe('completed');
    expect(result?.text).toBe('Subtask completed');
    expect(result?.taskId).toBe(taskId);
    expect(result?.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('stores failed result when generateText throws', async () => {
    mockGenerateText.mockRejectedValueOnce(new Error('API error'));

    const taskId = await spawnSubtask({
      channelId: 'ch-001',
      instruction: 'Will fail',
    });

    await Bun.sleep(100);

    const result = await getSubtaskResult(taskId);
    expect(result).not.toBeNull();
    expect(result?.status).toBe('failed');
    expect(result?.text).toBe('API error');
  });

  test('uses redis when available', async () => {
    mockRedisAvailable = true;
    mockRedisGet.mockResolvedValue(
      JSON.stringify({
        taskId: 'task-redis',
        text: 'from redis',
        status: 'completed',
        durationMs: 100,
      }),
    );

    const result = await getSubtaskResult('task-redis');
    expect(result).not.toBeNull();
    expect(result?.text).toBe('from redis');
  });
});

describe('getSubtaskResult', () => {
  beforeEach(() => {
    mockRedisAvailable = false;
    mockRedisGet.mockClear();
  });

  test('returns null for unknown task when redis unavailable', async () => {
    const result = await getSubtaskResult('nonexistent-task');
    expect(result).toBeNull();
  });

  test('returns null when redis returns nothing', async () => {
    mockRedisAvailable = true;
    mockRedisGet.mockResolvedValueOnce(null);

    const result = await getSubtaskResult('unknown-task');
    expect(result).toBeNull();
  });

  test('falls back to in-memory when redis get fails', async () => {
    mockRedisAvailable = true;
    mockRedisGet.mockRejectedValueOnce(new Error('Redis connection failed'));

    const result = await getSubtaskResult('some-task');
    expect(result).toBeNull();
  });
});
