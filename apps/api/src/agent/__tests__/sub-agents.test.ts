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
    // Added when `getProvider()` learned to consult `isConfigured()` for the
    // OAuth-token fallback; returning `true` preserves this suite's
    // pre-existing assumption that the requested provider is always available.
    isConfigured: () => true,
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

  test('passes abort signal to generateText', async () => {
    let capturedSignal: AbortSignal | undefined;
    mockGenerateText.mockImplementationOnce((opts: { abortSignal?: AbortSignal }) => {
      capturedSignal = opts.abortSignal;
      return Promise.resolve({ text: 'ok' });
    });

    await spawnSubtask({ channelId: 'ch-001', instruction: 'inspect signal' });
    await Bun.sleep(50);

    expect(capturedSignal).toBeDefined();
    // AbortSignal in Bun is an EventTarget; .aborted is the canonical flag.
    expect(typeof capturedSignal?.aborted).toBe('boolean');
  });

  test('records timeout status when abort fires before generateText completes', async () => {
    // Mock generateText to hang until the abort signal fires, mirroring how
    // a real LLM client behaves with abortSignal: it rejects with AbortError
    // when the controller aborts.
    mockGenerateText.mockImplementationOnce((opts: { abortSignal?: AbortSignal }) => {
      return new Promise((_, reject) => {
        opts.abortSignal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    const taskId = await spawnSubtask({
      channelId: 'ch-001',
      instruction: 'will time out',
      timeoutMs: 50,
    });

    await Bun.sleep(200);

    const result = await getSubtaskResult(taskId);
    expect(result).not.toBeNull();
    expect(result?.status).toBe('timeout');
    expect(result?.text).toBe('Subtask timed out');
  });

  test('clears timer immediately after generateText settles so a slow persist cannot flip status', async () => {
    // Mock storeResult-side latency: redis.set hangs for 80ms, longer than
    // the 30ms timeout budget. Under the fix the timer is cleared the
    // instant generateText resolves, so the timer cannot fire during the
    // persist and `controller.signal.aborted` stays false.
    mockRedisAvailable = true;
    let abortedDuringPersist = false;
    let capturedSignal: AbortSignal | undefined;
    mockGenerateText.mockImplementationOnce((opts: { abortSignal?: AbortSignal }) => {
      capturedSignal = opts.abortSignal;
      return Promise.resolve({ text: 'Subtask completed' });
    });
    mockRedisSet.mockImplementationOnce(async () => {
      await Bun.sleep(80);
      // Sample the controller state at the end of the slow persist. Under
      // the unfixed code the 30ms timer fires here and flips this to true.
      if (capturedSignal?.aborted) abortedDuringPersist = true;
      return 'OK';
    });

    await spawnSubtask({
      channelId: 'ch-001',
      instruction: 'fast generate, slow persist',
      timeoutMs: 30,
    });

    // Wait past both the 30ms timeout and the 80ms storeResult.
    await Bun.sleep(150);

    expect(abortedDuringPersist).toBe(false);
  });

  test('does not overwrite timeout outcome with a later completion', async () => {
    // Race: abort fires, but a stale completion arrives after. Production
    // honors the timeout verdict via the timedOut flag — assert no
    // completed/failed status is recorded when the abort already fired.
    let resolveLate: (value: { text: string }) => void = () => {};
    mockGenerateText.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLate = resolve;
        }),
    );

    const taskId = await spawnSubtask({
      channelId: 'ch-001',
      instruction: 'late completion',
      timeoutMs: 30,
    });

    // Wait for the abort to fire.
    await Bun.sleep(80);
    // Now trigger a late "successful" completion.
    resolveLate({ text: 'late result' });
    await Bun.sleep(30);

    const result = await getSubtaskResult(taskId);
    expect(result?.status).toBe('timeout');
    expect(result?.text).not.toBe('late result');
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
