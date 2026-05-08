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
    // Added when `getProvider()` learned to consult `isConfigured()` for the
    // OAuth-token fallback; returning `true` preserves this suite's
    // pre-existing assumption that the requested provider is always available.
    isConfigured: () => true,
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
  test('calls guardrails.preProcess with history from memoryEngine and updates input', async () => {
    const guardrails = {
      preProcess: mock(() =>
        Promise.resolve({ text: 'sanitized text', flagged: false, decision: null }),
      ),
      postProcess: mock(() => Promise.resolve('')),
    };
    const memoryEngine = {
      assembleContext: mock(() => Promise.resolve({ memories: [], messages: [] })),
    };
    const stage = preProcessStage(guardrails as never, memoryEngine as never);
    const ctx = makeBaseCtx();

    const result = await stage(ctx);

    expect(guardrails.preProcess).toHaveBeenCalled();
    expect(memoryEngine.assembleContext).toHaveBeenCalled();
    expect(result.input).toBe('sanitized text');
    expect(result.detectionFlagged).toBe(false);
  });

  test('preserves other context fields and propagates detectionFlagged on flag', async () => {
    const guardrails = {
      preProcess: mock(() => Promise.resolve({ text: 'ok', flagged: true, decision: null })),
    };
    const memoryEngine = {
      assembleContext: mock(() => Promise.resolve({ memories: [], messages: [] })),
    };
    const stage = preProcessStage(guardrails as never, memoryEngine as never);
    const ctx = makeBaseCtx({ memories: [{ id: 'm1' } as never] });

    const result = await stage(ctx);
    expect(result.memories).toHaveLength(1);
    expect(result.detectionFlagged).toBe(true);
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
  test('composes system prompt, loads skill IDs, injects canary when enabled', async () => {
    const promptComposer = {
      compose: mock(() =>
        Promise.resolve({
          systemPrompt: 'You are a helpful assistant.',
          loadedSkillIds: ['skill-1', 'skill-2'],
        }),
      ),
    };
    const guardrails = {
      generateCanaryForChannel: mock(() =>
        Promise.resolve({
          token: 'pc_canary_abc',
          emittedAt: 0,
          placementHint: 'test',
        }),
      ),
      injectCanaryIntoPrompt: mock((prompt: string) => `${prompt}\n<canary/>`),
    };
    const stage = composePromptStage(promptComposer as never, guardrails as never);
    const ctx = makeBaseCtx({
      tools: { memory_search: {} as never },
      safeToolNames: new Set(['memory_search']),
      memories: [],
    });

    const result = await stage(ctx);

    expect(result.systemPrompt).toContain('You are a helpful assistant.');
    expect(result.systemPrompt).toContain('<canary/>');
    expect(result.loadedSkillIds).toEqual(['skill-1', 'skill-2']);
    expect(result.canary).toBeDefined();
  });

  test('skips prompt composition when detectionBlockResponse is set', async () => {
    const promptComposer = {
      compose: mock(() =>
        Promise.resolve({ systemPrompt: 'should not be called', loadedSkillIds: [] }),
      ),
    };
    const guardrails = {
      generateCanaryForChannel: mock(() => Promise.resolve(null)),
      injectCanaryIntoPrompt: mock((p: string) => p),
    };
    const stage = composePromptStage(promptComposer as never, guardrails as never);
    const ctx = makeBaseCtx({ detectionBlockResponse: '⚠️ blocked' });
    const result = await stage(ctx);
    expect(promptComposer.compose).not.toHaveBeenCalled();
    expect(result.detectionBlockResponse).toBe('⚠️ blocked');
  });
});

describe('postProcessStage', () => {
  test('sanitizes response via guardrails with canary and audit metadata', async () => {
    const guardrails = {
      postProcess: mock(() => Promise.resolve('sanitized output')),
    };
    const stage = postProcessStage(guardrails as never);
    const ctx = makeBaseCtx({ response: 'raw output' });

    const result = await stage(ctx);
    expect(result.response).toBe('sanitized output');
    expect(guardrails.postProcess).toHaveBeenCalledWith('raw output', 'ch-001', null, {
      externalUserId: 'user-1',
      threadId: 'thread-1',
    });
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
  // Minimal stub detection engine for the gateway constructor. Unit tests
  // here don't exercise tool-output detection — they focus on the approval
  // wrapping — so a no-op engine is sufficient. The separate approval-gateway
  // and detection tests cover the filter behavior.
  const stubDetectionEngine = {
    detect: async () => ({
      decision: {
        action: 'allow' as const,
        riskScore: 0,
        layersFired: [],
        reasonCode: 'NO_MATCH',
        redactedExcerpt: '',
        referenceId: 'stub-ref-000',
        sourceKind: 'tool_result' as const,
      },
      layerResults: [],
    }),
  } as never;

  beforeEach(() => {
    // Reset DB mock to return empty rows so loadPolicies() succeeds with no policies
    mockDbSelect.mockReturnValue({
      from: mock(() => ({
        where: mock(() => Promise.resolve([])),
      })),
    });
  });

  test('adds confirm_plan tool to context', async () => {
    const ctx = makeBaseCtx({
      tools: { existing_tool: {} as never },
      safeToolNames: new Set<string>(),
    });

    const stage = wrapApprovalStage(stubDetectionEngine);
    const result = await stage(ctx);
    expect('confirm_plan' in result.tools).toBe(true);
    expect('existing_tool' in result.tools).toBe(true);
  });

  test('provides toolTimings map', async () => {
    const ctx = makeBaseCtx();
    const stage = wrapApprovalStage(stubDetectionEngine);
    const result = await stage(ctx);
    expect(result.toolTimings).toBeDefined();
    expect(result.toolTimings).toBeInstanceOf(Map);
  });

  test('provides getDismissedPlan function', async () => {
    const ctx = makeBaseCtx();
    const stage = wrapApprovalStage(stubDetectionEngine);
    const result = await stage(ctx);
    expect(typeof result.getDismissedPlan).toBe('function');
  });
});
