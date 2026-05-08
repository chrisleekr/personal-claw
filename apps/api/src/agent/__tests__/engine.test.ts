import { beforeEach, describe, expect, mock, test } from 'bun:test';

const mockPersistConversation = mock(() => Promise.resolve());
const mockPersistUserMessage = mock(() => Promise.resolve());

const mockStages = {
  preProcess: mock((ctx: unknown) => Promise.resolve(ctx)),
  assembleContext: mock((ctx: unknown) => Promise.resolve(ctx)),
  loadTools: mock((ctx: unknown) => Promise.resolve(ctx)),
  createSandbox: mock((ctx: unknown) => Promise.resolve(ctx)),
  composePrompt: mock((ctx: unknown) => Promise.resolve(ctx)),
  postProcess: mock((ctx: unknown) => Promise.resolve(ctx)),
  persist: mock((ctx: unknown) => Promise.resolve(ctx)),
};

mock.module('../pipeline', () => ({
  preProcessStage: () => mockStages.preProcess,
  assembleContextStage: () => mockStages.assembleContext,
  loadToolsStage: () => mockStages.loadTools,
  createSandboxStage: () => mockStages.createSandbox,
  wrapApprovalStage: () => (ctx: unknown) => Promise.resolve(ctx),
  composePromptStage: () => mockStages.composePrompt,
  generateStage: (ctx: Record<string, unknown>) =>
    Promise.resolve({
      ...ctx,
      providerName: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      result: { usage: { inputTokens: 100, outputTokens: 50 } },
      toolCallRecords: [],
      response: 'Hello from the engine',
    }),
  postProcessStage: () => mockStages.postProcess,
  persistStage: () => mockStages.persist,
  trackSkillUsageStage: (ctx: unknown) => Promise.resolve(ctx),
}));

mock.module('../../channels/resolver', () => ({
  ChannelResolver: {
    getInstance: () => ({ invalidate: mock() }),
  },
}));

mock.module('../../config/hot-reload', () => ({
  onConfigChange: mock(),
}));

mock.module('../../mcp/manager', () => ({
  MCPManager: class {
    async closeAll() {}
    invalidateAll() {}
    invalidateChannel() {}
  },
}));

mock.module('../../memory/engine', () => ({
  MemoryEngine: class {
    persistConversation = mockPersistConversation;
    persistUserMessage = mockPersistUserMessage;
    setDetectionEngine() {}
  },
}));

mock.module('../../sandbox/manager', () => ({
  SandboxManager: class {
    async initialize() {}
    async destroy() {}
    async destroyAll() {}
    shutdown() {}
  },
}));

mock.module('../guardrails', () => ({
  GuardrailsEngine: class {
    getDetectionEngine() {
      return {
        detect: async () => ({
          decision: {
            action: 'allow',
            riskScore: 0,
            layersFired: [],
            reasonCode: 'NO_MATCH',
            redactedExcerpt: '',
            referenceId: 'stub-ref',
            sourceKind: 'user_message',
          },
          layerResults: [],
        }),
      };
    }
  },
}));

mock.module('../prompt-composer', () => ({
  PromptComposer: class {},
}));

mock.module('../tool-registry', () => ({
  ToolRegistry: class {
    register() {}
  },
}));

mock.module('../tool-providers', () => ({
  MemoryToolProvider: class {},
  IdentityToolProvider: class {},
  CLIToolProvider: class {},
  BrowserToolProvider: class {},
  ScheduleToolProvider: class {},
  SubAgentToolProvider: class {},
  MCPToolProvider: class {},
}));

import type { ChannelAdapter } from '../../channels/adapter';
import { AgentEngine, shutdownEngine } from '../engine';

function makeAdapter(): ChannelAdapter {
  return {
    sendMessage: mock(() => Promise.resolve()),
    sendTyping: mock(() => Promise.resolve()),
    platform: 'test',
    channelId: 'ch-001',
  } as unknown as ChannelAdapter;
}

describe('AgentEngine', () => {
  beforeEach(() => {
    for (const s of Object.values(mockStages)) {
      s.mockClear();
    }
    mockPersistConversation.mockClear();
    mockPersistUserMessage.mockClear();
  });

  test('create returns an AgentEngine instance', async () => {
    const engine = await AgentEngine.create();
    expect(engine).toBeDefined();
    expect(engine).toBeInstanceOf(AgentEngine);
  });

  test('run executes pipeline and returns result', async () => {
    const engine = await AgentEngine.create();
    const result = await engine.run({
      channelId: 'ch-001',
      threadId: 'thread-1',
      userId: 'user-1',
      text: 'Hello',
      adapter: makeAdapter(),
    });

    expect(result.text).toBe('Hello from the engine');
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(50);
    expect(result.toolSequence).toEqual([]);
    expect(result.skillIds).toEqual([]);
  });

  test('run rethrows non-approval errors', async () => {
    mockStages.preProcess.mockImplementationOnce(() => {
      throw new Error('Unexpected failure');
    });

    const engine = await AgentEngine.create();
    await expect(
      engine.run({
        channelId: 'ch-001',
        threadId: 'thread-1',
        userId: 'user-1',
        text: 'Hello',
        adapter: makeAdapter(),
      }),
    ).rejects.toThrow('Unexpected failure');
  });

  test('run handles PlanRejectedError and returns canned response', async () => {
    mockStages.preProcess.mockImplementationOnce(() => {
      const err = new Error('Plan rejected');
      err.name = 'PlanRejectedError';
      throw err;
    });

    const engine = await AgentEngine.create();
    const result = await engine.run({
      channelId: 'ch-001',
      threadId: 'thread-1',
      userId: 'user-1',
      text: 'Do something',
      adapter: makeAdapter(),
    });

    expect(result.text).toContain("won't proceed");
    expect(result.provider).toBe('none');
    expect(result.model).toBe('none');
    expect(result.usage.inputTokens).toBe(0);
    expect(result.usage.outputTokens).toBe(0);
  });

  test('run handles ApprovalDismissedError by rethrowing', async () => {
    mockStages.preProcess.mockImplementationOnce(() => {
      const err = new Error('Approval dismissed');
      err.name = 'ApprovalDismissedError';
      throw err;
    });

    const engine = await AgentEngine.create();
    await expect(
      engine.run({
        channelId: 'ch-001',
        threadId: 'thread-1',
        userId: 'user-1',
        text: 'Something',
        adapter: makeAdapter(),
      }),
    ).rejects.toThrow('Approval dismissed');
  });
});

describe('shutdownEngine', () => {
  test('does not throw when no engine initialized', async () => {
    await expect(shutdownEngine()).resolves.toBeUndefined();
  });
});
