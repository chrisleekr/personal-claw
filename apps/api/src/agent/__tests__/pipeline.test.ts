import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ConversationMessage } from '@personalclaw/shared';

const mockDbInsert = mock(() => ({
  values: mock(() => Promise.resolve()),
}));
const mockDbSelect = mock(() => ({
  from: mock(() => ({
    where: mock(() => Promise.resolve([{ sandboxEnabled: false, sandboxConfig: null }])),
  })),
}));

mock.module('../../db', () => ({
  getDb: () => ({
    insert: mockDbInsert,
    select: mockDbSelect,
  }),
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

mock.module('../../sandbox/tools', () => ({
  getSandboxTools: () => ({}),
}));

import {
  assembleContextStage,
  composePromptStage,
  createSandboxStage,
  loadToolsStage,
  type PipelineContext,
  persistStage,
  postProcessStage,
  preProcessStage,
  trackSkillUsageStage,
  wrapApprovalStage,
} from '../pipeline';

function makeBaseCtx(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    params: {
      channelId: 'ch-001',
      threadId: 'thread-1',
      userId: 'user-1',
      text: 'Hello',
      adapter: {
        sendMessage: mock(() => Promise.resolve()),
        sendTyping: mock(() => Promise.resolve()),
        platform: 'test',
        channelId: 'ch-001',
      } as never,
    },
    input: 'Hello',
    memories: [],
    messages: [],
    tools: {},
    safeToolNames: new Set<string>(),
    systemPrompt: '',
    loadedSkillIds: [],
    providerName: '',
    model: '',
    result: null,
    toolCallRecords: [],
    response: '',
    startTime: Date.now(),
    ...overrides,
  };
}

describe('preProcessStage', () => {
  test('calls guardrails.preProcess and updates input', async () => {
    const guardrails = {
      preProcess: mock(() => Promise.resolve({ text: 'sanitized text' })),
      postProcess: mock(() => Promise.resolve('')),
    };
    const stage = preProcessStage(guardrails as never);
    const ctx = makeBaseCtx();

    const result = await stage(ctx);

    expect(guardrails.preProcess).toHaveBeenCalled();
    expect(result.input).toBe('sanitized text');
  });

  test('preserves other context fields', async () => {
    const guardrails = {
      preProcess: mock(() => Promise.resolve({ text: 'ok' })),
    };
    const stage = preProcessStage(guardrails as never);
    const ctx = makeBaseCtx({ memories: [{ id: 'm1' } as never] });

    const result = await stage(ctx);
    expect(result.memories).toHaveLength(1);
  });
});

describe('assembleContextStage', () => {
  test('populates memories and messages from engine', async () => {
    const memoryEngine = {
      assembleContext: mock(() =>
        Promise.resolve({
          memories: [{ id: 'mem-1', content: 'test memory' }],
          messages: [
            { role: 'user', content: 'Previous msg', timestamp: '2026-01-01T00:00:00Z' },
          ] as ConversationMessage[],
        }),
      ),
    };
    const stage = assembleContextStage(memoryEngine as never);
    const ctx = makeBaseCtx();

    const result = await stage(ctx);

    expect(result.memories).toHaveLength(1);
    expect(result.messages.length).toBeGreaterThanOrEqual(2);
  });

  test('includes user message at end of messages array', async () => {
    const memoryEngine = {
      assembleContext: mock(() => Promise.resolve({ memories: [], messages: [] })),
    };
    const stage = assembleContextStage(memoryEngine as never);
    const ctx = makeBaseCtx({ input: 'My question' });

    const result = await stage(ctx);
    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content).toBe('My question');
  });

  test('includes image attachments in user message', async () => {
    const memoryEngine = {
      assembleContext: mock(() => Promise.resolve({ memories: [], messages: [] })),
    };
    const stage = assembleContextStage(memoryEngine as never);
    const ctx = makeBaseCtx();
    ctx.params.images = [{ data: 'base64data', mimetype: 'image/png' }];

    const result = await stage(ctx);
    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(Array.isArray(lastMsg.content)).toBe(true);
    const parts = lastMsg.content as Array<Record<string, unknown>>;
    expect(parts.some((p) => p.type === 'image')).toBe(true);
  });
});

describe('loadToolsStage', () => {
  test('loads tools and safe names from registry', async () => {
    const toolRegistry = {
      loadAll: mock(() =>
        Promise.resolve({
          memory_search: { description: 'Search memory' },
          cli_exec: { description: 'Run CLI' },
        }),
      ),
      getSafeToolNames: mock(() => new Set(['memory_search'])),
    };
    const stage = loadToolsStage(toolRegistry as never);
    const ctx = makeBaseCtx();

    const result = await stage(ctx);

    expect(Object.keys(result.tools)).toContain('memory_search');
    expect(Object.keys(result.tools)).toContain('cli_exec');
    expect(result.safeToolNames.has('memory_search')).toBe(true);
    expect(result.safeToolNames.has('cli_exec')).toBe(false);
  });
});

describe('composePromptStage', () => {
  test('composes system prompt and loads skill IDs', async () => {
    const promptComposer = {
      compose: mock(() =>
        Promise.resolve({
          systemPrompt: 'You are a helpful assistant.',
          loadedSkillIds: ['skill-1', 'skill-2'],
        }),
      ),
    };
    const stage = composePromptStage(promptComposer as never);
    const ctx = makeBaseCtx({
      tools: { memory_search: {} as never },
      safeToolNames: new Set(['memory_search']),
      memories: [],
    });

    const result = await stage(ctx);

    expect(result.systemPrompt).toBe('You are a helpful assistant.');
    expect(result.loadedSkillIds).toEqual(['skill-1', 'skill-2']);
  });
});

describe('postProcessStage', () => {
  test('sanitizes response via guardrails', async () => {
    const guardrails = {
      postProcess: mock(() => Promise.resolve('sanitized output')),
    };
    const stage = postProcessStage(guardrails as never);
    const ctx = makeBaseCtx({ response: 'raw output' });

    const result = await stage(ctx);
    expect(result.response).toBe('sanitized output');
    expect(guardrails.postProcess).toHaveBeenCalledWith('raw output', 'ch-001');
  });
});

describe('persistStage', () => {
  test('persists user and assistant messages', async () => {
    const mockPersist = mock(() => Promise.resolve());
    const memoryEngine = {
      persistConversation: mockPersist,
    };
    const stage = persistStage(memoryEngine as never);
    const ctx = makeBaseCtx({ response: 'AI reply', toolCallRecords: [] });

    await stage(ctx);

    expect(mockPersist).toHaveBeenCalled();
    const args = mockPersist.mock.calls[0];
    expect(args[0]).toBe('ch-001');
    expect(args[1]).toBe('thread-1');
    expect((args[2] as Record<string, unknown>).role).toBe('user');
    expect((args[3] as Record<string, unknown>).role).toBe('assistant');
    expect((args[3] as Record<string, unknown>).content).toBe('AI reply');
  });

  test('includes image markers in user content when images present', async () => {
    const mockPersist = mock(() => Promise.resolve());
    const memoryEngine = { persistConversation: mockPersist };
    const stage = persistStage(memoryEngine as never);
    const ctx = makeBaseCtx({ response: 'response' });
    ctx.params.images = [{ data: 'base64', mimetype: 'image/jpeg' }];

    await stage(ctx);

    const userMsg = mockPersist.mock.calls[0][2] as Record<string, unknown>;
    expect(userMsg.content as string).toContain('[Image attached: image/jpeg]');
  });

  test('includes tool call records in assistant message', async () => {
    const mockPersist = mock(() => Promise.resolve());
    const memoryEngine = { persistConversation: mockPersist };
    const stage = persistStage(memoryEngine as never);
    const ctx = makeBaseCtx({
      response: 'done',
      toolCallRecords: [
        {
          toolName: 'memory_search',
          args: { query: 'test' },
          result: { found: true },
          durationMs: 100,
          requiresApproval: false,
          approved: null,
        },
      ],
    });

    await stage(ctx);

    const assistantMsg = mockPersist.mock.calls[0][3] as Record<string, unknown>;
    const toolCalls = assistantMsg.toolCalls as Array<Record<string, unknown>>;
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].toolName).toBe('memory_search');
  });
});

describe('trackSkillUsageStage', () => {
  beforeEach(() => {
    mockDbInsert.mockClear();
  });

  test('inserts skill usage when skill IDs present', async () => {
    const valuesFn = mock(() => Promise.resolve());
    mockDbInsert.mockReturnValue({ values: valuesFn });

    const ctx = makeBaseCtx({ loadedSkillIds: ['skill-1', 'skill-2'] });
    await trackSkillUsageStage(ctx);

    expect(mockDbInsert).toHaveBeenCalled();
    expect(valuesFn).toHaveBeenCalled();
  });

  test('skips insert when no skill IDs', async () => {
    mockDbInsert.mockClear();
    const ctx = makeBaseCtx({ loadedSkillIds: [] });
    await trackSkillUsageStage(ctx);

    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  test('does not throw on DB error', async () => {
    mockDbInsert.mockReturnValue({
      values: mock(() => Promise.reject(new Error('DB fail'))),
    });

    const ctx = makeBaseCtx({ loadedSkillIds: ['skill-1'] });
    await expect(trackSkillUsageStage(ctx)).resolves.toBeDefined();
  });
});

describe('createSandboxStage', () => {
  test('returns ctx unchanged when sandbox disabled', async () => {
    mockDbSelect.mockReturnValue({
      from: mock(() => ({
        where: mock(() => Promise.resolve([{ sandboxEnabled: false, sandboxConfig: null }])),
      })),
    });

    const sandboxManager = {
      getOrCreate: mock(() => Promise.resolve({})),
    };
    const stage = createSandboxStage(sandboxManager as never);
    const ctx = makeBaseCtx();

    const result = await stage(ctx);
    expect(result.sandbox).toBeUndefined();
    expect(sandboxManager.getOrCreate).not.toHaveBeenCalled();
  });

  test('creates sandbox and adds sandbox tools when enabled', async () => {
    mockDbSelect.mockReturnValue({
      from: mock(() => ({
        where: mock(() => Promise.resolve([{ sandboxEnabled: true, sandboxConfig: null }])),
      })),
    });

    const fakeSandbox = { id: 'sandbox-1' };
    const sandboxManager = {
      getOrCreate: mock(() => Promise.resolve(fakeSandbox)),
    };
    const stage = createSandboxStage(sandboxManager as never);
    const ctx = makeBaseCtx();

    const result = await stage(ctx);
    expect(result.sandbox).toBeDefined();
    expect(sandboxManager.getOrCreate).toHaveBeenCalled();
  });
});

describe('wrapApprovalStage', () => {
  test('adds confirm_plan tool to context', async () => {
    const ctx = makeBaseCtx({
      tools: { existing_tool: {} as never },
      safeToolNames: new Set<string>(),
    });

    const result = await wrapApprovalStage(ctx);
    expect('confirm_plan' in result.tools).toBe(true);
    expect('existing_tool' in result.tools).toBe(true);
  });

  test('provides toolTimings map', async () => {
    const ctx = makeBaseCtx();
    const result = await wrapApprovalStage(ctx);
    expect(result.toolTimings).toBeDefined();
    expect(result.toolTimings).toBeInstanceOf(Map);
  });

  test('provides getDismissedPlan function', async () => {
    const ctx = makeBaseCtx();
    const result = await wrapApprovalStage(ctx);
    expect(typeof result.getDismissedPlan).toBe('function');
  });
});
