import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const mockEngineRun = mock(() =>
  Promise.resolve({
    text: 'AI response',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    usage: { inputTokens: 100, outputTokens: 50 },
    durationMs: 500,
    toolSequence: ['memory_search'],
    skillIds: ['skill-1'],
  }),
);

mock.module('../engine', () => ({
  AgentEngine: {
    create: async () => ({
      run: mockEngineRun,
    }),
  },
}));

const mockCostLog = mock(() => Promise.resolve());
const mockIsBudgetExceeded = mock(() =>
  Promise.resolve({ exceeded: false, todaySpend: 0, budget: null }),
);

mock.module('../cost-tracker', () => ({
  CostTracker: class {
    log = mockCostLog;
    isBudgetExceeded = mockIsBudgetExceeded;
  },
}));

const mockHooksEmit = mock(() => Promise.resolve());

mock.module('../../hooks/engine', () => ({
  HooksEngine: {
    getInstance: () => ({
      emit: mockHooksEmit,
    }),
  },
}));

let mockRedisAvailable = false;
const mockRedisSet = mock(() => Promise.resolve('OK'));

mock.module('../../redis', () => ({
  isRedisAvailable: () => mockRedisAvailable,
  getRedis: () => ({
    set: mockRedisSet,
  }),
}));

import type { ChannelAdapter } from '../../channels/adapter';
import { MessageOrchestrator, type OrchestratorParams } from '../orchestrator';

function makeAdapter(): ChannelAdapter {
  return {
    sendMessage: mock(() => Promise.resolve()),
    sendTyping: mock(() => Promise.resolve()),
    platform: 'test',
    channelId: 'ch-001',
  } as unknown as ChannelAdapter;
}

function makeParams(overrides?: Partial<OrchestratorParams>): OrchestratorParams {
  return {
    channelId: 'ch-001',
    threadId: 'thread-1',
    userId: 'user-1',
    text: 'Hello',
    adapter: makeAdapter(),
    ...overrides,
  };
}

describe('MessageOrchestrator', () => {
  let orchestrator: MessageOrchestrator;

  beforeEach(() => {
    orchestrator = new MessageOrchestrator();
    mockRedisAvailable = false;
    mockEngineRun.mockClear();
    mockCostLog.mockClear();
    mockIsBudgetExceeded.mockClear();
    mockHooksEmit.mockClear();
    mockRedisSet.mockClear();
  });

  afterEach(() => {
    mockRedisAvailable = false;
  });

  describe('checkBudget', () => {
    test('delegates to costTracker.isBudgetExceeded', async () => {
      mockIsBudgetExceeded.mockResolvedValueOnce({
        exceeded: true,
        todaySpend: 10,
        budget: 5,
      });

      const result = await orchestrator.checkBudget('ch-001');
      expect(result.exceeded).toBe(true);
      expect(result.todaySpend).toBe(10);
      expect(result.budget).toBe(5);
      expect(mockIsBudgetExceeded).toHaveBeenCalledWith('ch-001');
    });

    test('returns not exceeded when no budget', async () => {
      const result = await orchestrator.checkBudget('ch-002');
      expect(result.exceeded).toBe(false);
    });
  });

  describe('process', () => {
    test('emits message:received hook before running engine', async () => {
      await orchestrator.process(makeParams());

      const firstEmitCall = mockHooksEmit.mock.calls[0];
      expect(firstEmitCall[0]).toBe('message:received');
      expect(firstEmitCall[1].channelId).toBe('ch-001');
      expect(firstEmitCall[1].payload.text).toBe('Hello');
    });

    test('calls engine.run with correct params', async () => {
      await orchestrator.process(makeParams());

      expect(mockEngineRun).toHaveBeenCalled();
      const runArgs = mockEngineRun.mock.calls[0][0] as Record<string, unknown>;
      expect(runArgs.channelId).toBe('ch-001');
      expect(runArgs.threadId).toBe('thread-1');
      expect(runArgs.userId).toBe('user-1');
      expect(runArgs.text).toBe('Hello');
    });

    test('logs cost after engine run', async () => {
      await orchestrator.process(makeParams());

      expect(mockCostLog).toHaveBeenCalled();
      const logArgs = mockCostLog.mock.calls[0][0] as Record<string, unknown>;
      expect(logArgs.channelId).toBe('ch-001');
      expect(logArgs.provider).toBe('anthropic');
      expect(logArgs.model).toBe('claude-sonnet-4-20250514');
      expect(logArgs.promptTokens).toBe(100);
      expect(logArgs.completionTokens).toBe(50);
    });

    test('sends message via adapter', async () => {
      const adapter = makeAdapter();
      await orchestrator.process(makeParams({ adapter }));

      expect(adapter.sendMessage).toHaveBeenCalledWith('thread-1', 'AI response');
    });

    test('emits message:sending and message:sent hooks', async () => {
      await orchestrator.process(makeParams());

      const emitCalls = mockHooksEmit.mock.calls.map((c) => c[0]);
      expect(emitCalls).toContain('message:sending');
      expect(emitCalls).toContain('message:sent');
    });

    test('returns structured result', async () => {
      const result = await orchestrator.process(makeParams());

      expect(result.text).toBe('AI response');
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-sonnet-4-20250514');
      expect(result.inputTokens).toBe(100);
      expect(result.outputTokens).toBe(50);
      expect(result.durationMs).toBe(500);
    });

    test('stores feedback metadata in redis when available', async () => {
      mockRedisAvailable = true;
      await orchestrator.process(makeParams());

      expect(mockRedisSet).toHaveBeenCalled();
      const setArgs = mockRedisSet.mock.calls[0];
      expect(setArgs[0]).toContain('feedback:');
      const parsed = JSON.parse(setArgs[1] as string) as Record<string, unknown>;
      expect(parsed.toolSequence).toEqual(['memory_search']);
      expect(parsed.skillIds).toEqual(['skill-1']);
    });

    test('skips feedback metadata when redis unavailable', async () => {
      mockRedisAvailable = false;
      await orchestrator.process(makeParams());

      expect(mockRedisSet).not.toHaveBeenCalled();
    });

    test('skips feedback metadata when no tool calls', async () => {
      mockRedisAvailable = true;
      mockEngineRun.mockResolvedValueOnce({
        text: 'Simple response',
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        usage: { inputTokens: 50, outputTokens: 25 },
        durationMs: 200,
        toolSequence: [],
        skillIds: [],
      });

      await orchestrator.process(makeParams());
      expect(mockRedisSet).not.toHaveBeenCalled();
    });
  });
});
