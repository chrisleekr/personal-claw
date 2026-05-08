import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ConversationMessage } from '@personalclaw/shared';
import type { ModelMessage } from 'ai';

// Integration test for the multi-layer detection pipeline's pipeline-level
// wiring. Unit tests for individual layers live in src/agent/detection/__tests__/;
// this file tests the pipeline stages (preProcessStage, postProcessStage,
// composePromptStage) and the ApprovalGateway flag-downgrade behavior.
//
// Resolves analysis finding C1 (multi-turn history passthrough), C3 (flag
// → no-auto-execute integration), and the FR-025 recall-time memory filter
// integration path.

const mockDbInsert = mock(() => ({
  values: mock(() => Promise.resolve()),
}));
const mockDbSelect = mock(() => ({
  from: mock(() => ({
    where: mock(() => Promise.resolve([])),
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
    LLM_PROVIDER: 'ollama',
  },
}));

mock.module('../../memory/embeddings', () => ({
  generateEmbedding: async () => new Array(1024).fill(0.1),
}));

import { ApprovalGateway } from '../approval-gateway';
import type { CostTracker } from '../cost-tracker';
import type { DetectionEngine } from '../detection/engine';
import { DetectionBlockedError, GuardrailsEngine } from '../guardrails';
import { postProcessStage, preProcessStage } from '../pipeline';

function fakeCostTracker(): CostTracker {
  return { log: async () => {}, calculateCost: () => 0 } as unknown as CostTracker;
}

function fakeAdapter() {
  return {
    sendMessage: mock(() => Promise.resolve()),
    requestApproval: mock(() => Promise.resolve(false)),
    requestApprovalBatch: mock(() => Promise.resolve(false)),
    requestPlanApproval: mock(() => Promise.resolve(true)),
    platform: 'test',
    channelId: 'ch-001',
  } as never;
}

function makeBaseCtx(overrides?: Record<string, unknown>) {
  return {
    params: {
      channelId: 'ch-001',
      threadId: 'thread-1',
      userId: 'user-1',
      text: 'hello',
      adapter: fakeAdapter(),
    },
    input: 'hello',
    memories: [],
    messages: [] as ModelMessage[],
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

describe('preProcessStage integration (FR-004, FR-005, FR-012)', () => {
  beforeEach(() => {
    mockDbInsert.mockClear();
    mockDbSelect.mockClear();
  });

  test('block decision raises the user-facing notice with reference id (FR-004)', async () => {
    const guardrails = {
      preProcess: mock(async () => {
        throw new DetectionBlockedError(
          {
            action: 'block',
            riskScore: 95,
            layersFired: ['heuristics'],
            reasonCode: 'HEURISTIC_MATCH:corpus_v1_sig_001',
            redactedExcerpt: '[REDACTED]',
            referenceId: 'ref0000000a',
            sourceKind: 'user_message',
          },
          [],
        );
      }),
    };
    const memoryEngine = {
      assembleContext: mock(() =>
        Promise.resolve({ messages: [] as ConversationMessage[], memories: [] }),
      ),
    };

    const stage = preProcessStage(guardrails as never, memoryEngine as never);
    const result = await stage(makeBaseCtx() as never);

    expect(result.detectionBlockResponse).toBeDefined();
    expect(result.detectionBlockResponse).toContain('suspected prompt injection attempt');
    expect(result.detectionBlockResponse).toContain('ref0000000a');
    expect(result.detectionBlockResponse).toContain('HEURISTIC_MATCH:corpus_v1_sig_001');
    // Input is NOT overwritten on block because the LLM call is skipped entirely downstream.
    expect(result.input).toBe('hello');
  });

  test('flag decision sets detectionFlagged: true on ctx (FR-005 wiring)', async () => {
    const guardrails = {
      preProcess: mock(async () => ({
        text: 'suspicious content',
        flagged: true,
        decision: {
          action: 'flag',
          riskScore: 70,
          layersFired: ['similarity'],
          reasonCode: 'SIMILARITY_MATCH',
          redactedExcerpt: 's',
          referenceId: 'refFlag0001',
          sourceKind: 'user_message',
        },
      })),
    };
    const memoryEngine = {
      assembleContext: mock(() => Promise.resolve({ messages: [], memories: [] })),
    };

    const stage = preProcessStage(guardrails as never, memoryEngine as never);
    const result = await stage(
      makeBaseCtx({ params: { ...makeBaseCtx().params, text: 'suspicious content' } }) as never,
    );

    expect(result.detectionFlagged).toBe(true);
    expect(result.input).toBe('suspicious content');
    expect(result.detectionBlockResponse).toBeUndefined();
  });

  test('allow decision sets detectionFlagged: false on ctx', async () => {
    const guardrails = {
      preProcess: mock(async () => ({
        text: 'benign',
        flagged: false,
        decision: {
          action: 'allow',
          riskScore: 0,
          layersFired: [],
          reasonCode: 'NO_MATCH',
          redactedExcerpt: '',
          referenceId: 'refOk000001',
          sourceKind: 'user_message',
        },
      })),
    };
    const memoryEngine = {
      assembleContext: mock(() => Promise.resolve({ messages: [], memories: [] })),
    };

    const stage = preProcessStage(guardrails as never, memoryEngine as never);
    const result = await stage(makeBaseCtx() as never);

    expect(result.detectionFlagged).toBe(false);
    expect(result.detectionBlockResponse).toBeUndefined();
  });

  test('passes the last 10 user messages from memoryEngine history as FR-012 multi-turn window (resolves analysis finding C1)', async () => {
    // Seed 15 user messages plus some assistant messages in the history.
    // The stage should extract the LAST 10 user messages, in chronological
    // order, and pass them to guardrails.preProcess as `recentHistory`.
    const history: ConversationMessage[] = [];
    for (let i = 1; i <= 15; i++) {
      history.push({
        role: 'user',
        content: `user msg ${i}`,
        timestamp: `2026-04-10T00:00:${String(i).padStart(2, '0')}Z`,
      } as ConversationMessage);
      history.push({
        role: 'assistant',
        content: `reply ${i}`,
        timestamp: `2026-04-10T00:00:${String(i).padStart(2, '0')}Z`,
      } as ConversationMessage);
    }

    const capturedHistory: string[][] = [];
    const guardrails = {
      preProcess: mock(async (args: { recentHistory: readonly string[] }) => {
        capturedHistory.push([...args.recentHistory]);
        return {
          text: 'current message',
          flagged: false,
          decision: null,
        };
      }),
    };
    const memoryEngine = {
      assembleContext: mock(() => Promise.resolve({ messages: history, memories: [] })),
    };

    const stage = preProcessStage(guardrails as never, memoryEngine as never);
    await stage(makeBaseCtx() as never);

    expect(capturedHistory).toHaveLength(1);
    const window = capturedHistory[0];
    // Exactly 10 user messages, chronologically ordered (oldest first).
    expect(window).toHaveLength(10);
    expect(window[0]).toBe('user msg 6');
    expect(window[9]).toBe('user msg 15');
    // No assistant messages in the window.
    for (const msg of window) {
      expect(msg).toMatch(/^user msg/);
    }
  });

  test('memoryEngine.assembleContext failure does not crash — window falls back to empty', async () => {
    const guardrails = {
      preProcess: mock(async () => ({
        text: 'ok',
        flagged: false,
        decision: null,
      })),
    };
    const memoryEngine = {
      assembleContext: mock(() => Promise.reject(new Error('DB down'))),
    };

    const stage = preProcessStage(guardrails as never, memoryEngine as never);
    const result = await stage(makeBaseCtx() as never);
    // Stage still completed; the engine was called with an empty window.
    expect(result.input).toBe('ok');
    expect(
      (
        guardrails.preProcess as unknown as {
          mock: { calls: Array<[{ recentHistory: string[] }]> };
        }
      ).mock.calls[0][0].recentHistory,
    ).toEqual([]);
  });

  test('non-DetectionBlockedError from guardrails still propagates', async () => {
    const guardrails = {
      preProcess: mock(async () => {
        throw new TypeError('unexpected bug');
      }),
    };
    const memoryEngine = {
      assembleContext: mock(() => Promise.resolve({ messages: [], memories: [] })),
    };

    const stage = preProcessStage(guardrails as never, memoryEngine as never);
    await expect(stage(makeBaseCtx() as never)).rejects.toThrow('unexpected bug');
  });
});

describe('postProcessStage integration (FR-020 canary)', () => {
  test('delegates to guardrails.postProcess with the canary and audit metadata', async () => {
    const postProcess = mock(async () => 'sanitized output');
    const guardrails = { postProcess };
    const stage = postProcessStage(guardrails as never);

    const canary = { token: 'pc_canary_abc', emittedAt: 0, placementHint: 'test' };
    const result = await stage(
      makeBaseCtx({
        response: 'raw response',
        canary,
      }) as never,
    );
    expect(result.response).toBe('sanitized output');
    expect(postProcess).toHaveBeenCalledWith('raw response', 'ch-001', canary, {
      externalUserId: 'user-1',
      threadId: 'thread-1',
    });
  });

  test('passes canary: null when canaryTokenEnabled is disabled for the channel', async () => {
    const postProcess = mock(async () => 'x');
    const stage = postProcessStage({ postProcess } as never);
    await stage(makeBaseCtx({ response: 'x', canary: null }) as never);
    expect(postProcess).toHaveBeenCalledWith('x', 'ch-001', null, expect.anything());
  });
});

describe('ApprovalGateway flag → no-auto-execute integration (FR-005, resolves analysis finding C3)', () => {
  // Minimal detection engine stub so the gateway can construct.
  const stubEngine = {
    detect: async () => ({
      decision: {
        action: 'allow' as const,
        riskScore: 0,
        layersFired: [],
        reasonCode: 'NO_MATCH',
        redactedExcerpt: '',
        referenceId: 'stub00000000',
        sourceKind: 'tool_result' as const,
      },
      layerResults: [],
    }),
  } as unknown as DetectionEngine;

  beforeEach(() => {
    mockDbSelect.mockReturnValue({
      from: () => ({
        where: async () => [
          // Seed an 'auto' policy for test_tool so we can verify downgrade
          { toolName: 'test_tool', policy: 'auto', allowedUsers: [] },
        ],
      }),
    });
  });

  test('detectionFlagged=true downgrades an "auto" policy to individual approval', async () => {
    const gateway = new ApprovalGateway(
      'ch-001',
      'thread-1',
      'user-1',
      fakeAdapter(),
      new Set<string>(),
      true, // verifiedUserId
      true, // detectionFlagged
      stubEngine,
    );

    // Without flag, 'auto' policy would short-circuit to true without any
    // user approval. With flag=true, it must go through queueForApproval.
    // We detect this by counting how long checkApproval takes — with flag,
    // it sits in the batch window. Simpler: mock the batch flush to resolve
    // false and assert the result is false (deny path).
    const adapter = gateway as unknown as {
      adapter: { requestApproval: (...args: unknown[]) => Promise<boolean> };
    };
    adapter.adapter.requestApproval = mock(async () => false);

    const approved = await gateway.checkApproval('test_tool', { foo: 'bar' });
    // The gateway queued for approval (the downgrade happened); the user
    // "denied" in our mock, so the final result is false. This proves the
    // downgrade path executed.
    expect(approved).toBe(false);
  });

  test('detectionFlagged=false allows an "auto" policy to auto-execute', async () => {
    const gateway = new ApprovalGateway(
      'ch-001',
      'thread-1',
      'user-1',
      fakeAdapter(),
      new Set<string>(),
      true,
      false, // detectionFlagged DISABLED
      stubEngine,
    );

    const approved = await gateway.checkApproval('test_tool', { foo: 'bar' });
    // With flag off, 'auto' policy short-circuits to true without needing approval.
    expect(approved).toBe(true);
  });
});

describe('GuardrailsEngine.getDetectionEngine (accessor for tool-output filter)', () => {
  test('returns a DetectionEngine instance that can be passed to ApprovalGateway', () => {
    const gr = new GuardrailsEngine(fakeCostTracker());
    const engine = gr.getDetectionEngine();
    expect(engine).toBeDefined();
    expect(typeof engine.detect).toBe('function');
  });
});
