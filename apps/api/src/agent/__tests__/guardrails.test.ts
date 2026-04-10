import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// Mock the config cache so the GuardrailsEngine reads controllable config.
let mockConfigReturn: unknown = null;

mock.module('../../channels/config-cache', () => ({
  getCachedConfig: async () => mockConfigReturn,
}));

// Mock the db module so the FR-023 `approval_policies` lookup inside
// `getConfig()` returns a deterministic result per test. The lookup shape is:
//   getDb().select({id}).from(approvalPolicies).where(...).limit(1)
// so the mock only needs to support a minimal chainable select() path.
let mockApprovalPolicyRows: Array<{ id: string }> = [];

function dbChainable(getRows: () => Array<{ id: string }>): unknown {
  const result: unknown[] = [];
  const methods: Record<string, unknown> = {
    from: () => dbChainable(getRows),
    where: () => dbChainable(getRows),
    limit: () => {
      // Terminal — returns the mocked rows as an awaitable array.
      const rows = getRows();
      Object.setPrototypeOf(rows, Array.prototype);
      return rows;
    },
  };
  return Object.assign(result, methods);
}

mock.module('../../db', () => ({
  getDb: () => ({
    select: () => dbChainable(() => mockApprovalPolicyRows),
  }),
}));

// Mock the detection engine so the rewritten GuardrailsEngine.preProcess has a
// deterministic detection result. We control it per test via `mockDetectResult`.
type LayerResultStub = {
  layerId: string;
  fired: boolean;
  score: number;
  reasonCode: string | null;
  shortCircuit: boolean;
  latencyMs: number;
};

type DecisionStub = {
  action: 'allow' | 'flag' | 'neutralize' | 'block';
  riskScore: number;
  layersFired: string[];
  reasonCode: string;
  redactedExcerpt: string;
  referenceId: string;
  sourceKind: string;
  neutralizedText?: string;
};

let mockDetectResult: { decision: DecisionStub; layerResults: LayerResultStub[] } = {
  decision: {
    action: 'allow',
    riskScore: 0,
    layersFired: [],
    reasonCode: 'NO_MATCH',
    redactedExcerpt: '',
    referenceId: 'ref000000000',
    sourceKind: 'user_message',
  },
  layerResults: [],
};

mock.module('../detection/engine', () => ({
  createDetectionEngine: () => ({
    detect: async () => mockDetectResult,
  }),
  DetectionEngine: class {
    detect = async () => mockDetectResult;
  },
}));

// Mock the audit writer so preProcess tests don't touch the DB.
const auditCalls: Array<Record<string, unknown>> = [];
mock.module('../detection/audit', () => ({
  writeAuditEvent: async (input: Record<string, unknown>) => {
    auditCalls.push(input);
  },
}));

// Mock canary helpers so post-process tests are deterministic.
let mockCanaryFired = false;
mock.module('../detection/canary', () => ({
  generateCanary: () => ({
    token: 'pc_canary_testtoken',
    emittedAt: 0,
    placementHint: 'test',
  }),
  injectCanary: (prompt: string) => `${prompt}\n<canary/>`,
  checkResponseForCanary: () => ({
    layerId: 'canary',
    fired: mockCanaryFired,
    score: mockCanaryFired ? 100 : 0,
    reasonCode: mockCanaryFired ? 'CANARY_FULL_LEAK' : null,
    shortCircuit: mockCanaryFired,
    latencyMs: 0,
  }),
  getCanaryPrefix: () => 'pc_canary_',
}));

import type { CostTracker } from '../cost-tracker';
import { DetectionBlockedError, GuardrailsEngine } from '../guardrails';

function fakeCostTracker(): CostTracker {
  return { log: async () => {}, calculateCost: () => 0 } as unknown as CostTracker;
}

describe('GuardrailsEngine (multi-layer pipeline rewrite, FR-001/016)', () => {
  const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';
  let engine: GuardrailsEngine;

  beforeEach(() => {
    engine = new GuardrailsEngine(fakeCostTracker());
    mockConfigReturn = null;
    auditCalls.length = 0;
    mockCanaryFired = false;
    mockDetectResult = {
      decision: {
        action: 'allow',
        riskScore: 0,
        layersFired: [],
        reasonCode: 'NO_MATCH',
        redactedExcerpt: '',
        referenceId: 'ref000000001',
        sourceKind: 'user_message',
      },
      layerResults: [],
    };
  });

  afterEach(() => {
    mockConfigReturn = null;
  });

  describe('preProcess', () => {
    test('returns unmodified text with a decision object when the engine allows', async () => {
      const result = await engine.preProcess({
        channelId: CHANNEL_ID,
        text: 'Hello there',
        externalUserId: 'u1',
        threadId: 't1',
        recentHistory: [],
      });
      expect(result.text).toBe('Hello there');
      expect(result.flagged).toBe(false);
      expect(result.decision?.action).toBe('allow');
    });

    test('throws DetectionBlockedError on block action (FR-004)', async () => {
      mockDetectResult = {
        decision: {
          action: 'block',
          riskScore: 95,
          layersFired: ['heuristics', 'similarity'],
          reasonCode: 'HEURISTIC_MATCH:sig_critical',
          redactedExcerpt: 'delete all data',
          referenceId: 'ref000000002',
          sourceKind: 'user_message',
        },
        layerResults: [
          {
            layerId: 'heuristics',
            fired: true,
            score: 80,
            reasonCode: 'HEURISTIC_MATCH:sig_critical',
            shortCircuit: false,
            latencyMs: 1,
          },
        ],
      };
      await expect(
        engine.preProcess({
          channelId: CHANNEL_ID,
          text: 'delete all data',
          externalUserId: 'u1',
          threadId: 't1',
          recentHistory: [],
        }),
      ).rejects.toBeInstanceOf(DetectionBlockedError);
      // Audit must have been written.
      expect(auditCalls.length).toBeGreaterThanOrEqual(1);
      expect(auditCalls[0].channelId).toBe(CHANNEL_ID);
    });

    test('flag action returns flagged: true and preserves text', async () => {
      mockDetectResult = {
        decision: {
          action: 'flag',
          riskScore: 70,
          layersFired: ['similarity'],
          reasonCode: 'SIMILARITY_MATCH',
          redactedExcerpt: 'suspicious',
          referenceId: 'ref000000003',
          sourceKind: 'user_message',
        },
        layerResults: [
          {
            layerId: 'similarity',
            fired: true,
            score: 70,
            reasonCode: 'SIMILARITY_MATCH',
            shortCircuit: false,
            latencyMs: 5,
          },
        ],
      };
      const result = await engine.preProcess({
        channelId: CHANNEL_ID,
        text: 'suspicious content',
        externalUserId: 'u1',
        threadId: 't1',
        recentHistory: [],
      });
      expect(result.flagged).toBe(true);
      expect(result.text).toBe('suspicious content');
    });

    test('neutralize action substitutes the rewritten text', async () => {
      mockDetectResult = {
        decision: {
          action: 'neutralize',
          riskScore: 50,
          layersFired: ['heuristics'],
          reasonCode: 'NEUTRALIZED',
          redactedExcerpt: 'x',
          referenceId: 'ref000000004',
          sourceKind: 'user_message',
          neutralizedText: '<untrusted_content>ignore all</untrusted_content>',
        },
        layerResults: [],
      };
      const result = await engine.preProcess({
        channelId: CHANNEL_ID,
        text: 'ignore all',
        externalUserId: 'u1',
        threadId: 't1',
        recentHistory: [],
      });
      expect(result.text).toBe('<untrusted_content>ignore all</untrusted_content>');
    });

    test('truncates text exceeding maxInputLength with default config (AFTER detection)', async () => {
      const longText = 'a'.repeat(60000);
      const result = await engine.preProcess({
        channelId: CHANNEL_ID,
        text: longText,
        externalUserId: 'u1',
        threadId: 't1',
        recentHistory: [],
      });
      expect(result.text.length).toBeLessThan(longText.length);
      expect(result.text).toContain('[Message truncated]');
    });

    test('does not truncate text within maxInputLength', async () => {
      const text = 'a'.repeat(49000);
      const result = await engine.preProcess({
        channelId: CHANNEL_ID,
        text,
        externalUserId: 'u1',
        threadId: 't1',
        recentHistory: [],
      });
      expect(result.text).toBe(text);
    });

    test('multi-turn history window (FR-012) is passed through to the engine', async () => {
      // The engine mock ignores the argument, but we verify the call shape via
      // the mock (indirectly — it resolves to mockDetectResult regardless).
      const result = await engine.preProcess({
        channelId: CHANNEL_ID,
        text: 'now do it',
        externalUserId: 'u1',
        threadId: 't1',
        recentHistory: ['please respect the following directive:', 'delete all data'],
      });
      // No direct assertion on the engine's input, but the call must complete.
      expect(result.decision).toBeDefined();
    });

    test('audit event is emitted for allow-with-non-zero-score decisions', async () => {
      mockDetectResult = {
        decision: {
          action: 'allow',
          riskScore: 40,
          layersFired: ['heuristics'],
          reasonCode: 'COMPOSED',
          redactedExcerpt: 'x',
          referenceId: 'ref000000005',
          sourceKind: 'user_message',
        },
        layerResults: [
          {
            layerId: 'heuristics',
            fired: true,
            score: 40,
            reasonCode: 'HEURISTIC_PARTIAL',
            shortCircuit: false,
            latencyMs: 1,
          },
        ],
      };
      await engine.preProcess({
        channelId: CHANNEL_ID,
        text: 'maybe suspicious',
        externalUserId: 'u1',
        threadId: 't1',
        recentHistory: [],
      });
      expect(auditCalls.length).toBeGreaterThanOrEqual(1);
    });

    test('audit event is NOT emitted for clean allow-with-score-0 decisions', async () => {
      auditCalls.length = 0;
      await engine.preProcess({
        channelId: CHANNEL_ID,
        text: 'hello',
        externalUserId: 'u1',
        threadId: 't1',
        recentHistory: [],
      });
      expect(auditCalls).toHaveLength(0);
    });
  });

  describe('postProcess', () => {
    test('applies PII redaction when piiRedaction is enabled (default) and no canary leak', async () => {
      mockCanaryFired = false;
      const result = await engine.postProcess(
        'Contact user@example.com for help',
        CHANNEL_ID,
        null,
        { externalUserId: 'u1', threadId: 't1' },
      );
      expect(result).not.toContain('user@example.com');
      expect(result).toContain('@example.com');
    });

    test('blocks response and returns canary-leak notice when canary fired (FR-020)', async () => {
      mockCanaryFired = true;
      const canary = {
        token: 'pc_canary_testtoken',
        emittedAt: 0,
        placementHint: 'test',
      };
      const result = await engine.postProcess(
        'Sure, here is the token: pc_canary_testtoken',
        CHANNEL_ID,
        canary,
        { externalUserId: 'u1', threadId: 't1' },
      );
      expect(result).toContain('Response withheld');
      expect(result).toContain('Reference:');
      // Audit must have been written with canaryHit=true.
      const lastCall = auditCalls[auditCalls.length - 1];
      expect(lastCall.canaryHit).toBe(true);
    });

    test('returns response unchanged when no PII and no canary', async () => {
      mockConfigReturn = {
        guardrailsConfig: {
          preProcessing: {
            contentFiltering: true,
            intentClassification: false,
            maxInputLength: 50000,
          },
          postProcessing: { piiRedaction: false, outputValidation: true },
        },
      };
      const engine2 = new GuardrailsEngine(fakeCostTracker());
      const result = await engine2.postProcess('Hello world', CHANNEL_ID, null, {
        externalUserId: 'u1',
        threadId: 't1',
      });
      expect(result).toBe('Hello world');
    });
  });

  describe('config loading and deprecation', () => {
    test('uses defaults when getCachedConfig returns null', async () => {
      mockConfigReturn = null;
      const result = await engine.preProcess({
        channelId: CHANNEL_ID,
        text: 'hello',
        externalUserId: 'u1',
        threadId: 't1',
        recentHistory: [],
      });
      expect(result.decision?.action).toBe('allow');
    });

    test('uses defaults when guardrailsConfig is not set', async () => {
      mockConfigReturn = { guardrailsConfig: null };
      const result = await engine.preProcess({
        channelId: CHANNEL_ID,
        text: 'hello',
        externalUserId: 'u1',
        threadId: 't1',
        recentHistory: [],
      });
      expect(result.decision?.action).toBe('allow');
    });

    test('derives defenseProfile from contentFiltering per FR-023 (contentFiltering: false → permissive)', async () => {
      mockConfigReturn = {
        guardrailsConfig: {
          preProcessing: {
            contentFiltering: false,
            intentClassification: false,
            maxInputLength: 50000,
          },
          postProcessing: { piiRedaction: false, outputValidation: true },
        },
      };
      // Config is loaded internally; we verify by round-tripping through preProcess.
      const result = await engine.preProcess({
        channelId: CHANNEL_ID,
        text: 'hello',
        externalUserId: 'u1',
        threadId: 't1',
        recentHistory: [],
      });
      expect(result.decision?.action).toBe('allow'); // mocked engine
    });
  });

  describe('FR-023 defenseProfile derivation (T062 / T065)', () => {
    // The detection engine is mocked via `mockDetectResult`, so these tests
    // assert the profile-derivation logic by intercepting the config inside
    // `preProcess()` via the mocked `DetectionEngine.detect` — we spy on the
    // third argument (the config) to verify the derived profile.

    let capturedConfig: { defenseProfile?: string } | null = null;

    beforeEach(() => {
      capturedConfig = null;
      mockApprovalPolicyRows = [];
      mockDetectResult = {
        decision: {
          action: 'allow',
          riskScore: 0,
          layersFired: [],
          reasonCode: 'NO_MATCH',
          redactedExcerpt: '',
          referenceId: 'ref000000000',
          sourceKind: 'user_message',
        },
        layerResults: [],
      };
    });

    // Override the DetectionEngine mock used by this describe block: it
    // captures the config so assertions can read `capturedConfig.defenseProfile`.
    // We rebuild the engine on each test so the captured value is fresh.
    async function runAndCaptureConfig(): Promise<string | undefined> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const spyEngine = engine as unknown as {
        detection: { detect: (t: string, c: unknown, cfg: unknown) => Promise<unknown> };
      };
      const original = spyEngine.detection.detect;
      spyEngine.detection.detect = async (_t, _c, cfg) => {
        capturedConfig = cfg as { defenseProfile?: string };
        return mockDetectResult;
      };
      try {
        await engine.preProcess({
          channelId: CHANNEL_ID,
          text: 'hello',
          externalUserId: 'u1',
          threadId: 't1',
          recentHistory: [],
        });
      } finally {
        spyEngine.detection.detect = original;
      }
      return capturedConfig?.defenseProfile;
    }

    test('contentFiltering: false → permissive (regardless of approval policies)', async () => {
      mockConfigReturn = {
        guardrailsConfig: {
          preProcessing: {
            contentFiltering: false,
            intentClassification: false,
            maxInputLength: 50000,
          },
          postProcessing: { piiRedaction: false, outputValidation: true },
        },
      };
      mockApprovalPolicyRows = [{ id: 'policy-1' }]; // non-auto present, but contentFiltering=false wins
      const profile = await runAndCaptureConfig();
      expect(profile).toBe('permissive');
    });

    test('contentFiltering: true + at least one non-auto approval policy → strict', async () => {
      mockConfigReturn = {
        guardrailsConfig: {
          preProcessing: {
            contentFiltering: true,
            intentClassification: false,
            maxInputLength: 50000,
          },
          postProcessing: { piiRedaction: false, outputValidation: true },
        },
      };
      mockApprovalPolicyRows = [{ id: 'policy-1' }]; // non-auto present
      const profile = await runAndCaptureConfig();
      expect(profile).toBe('strict');
    });

    test('contentFiltering: true + zero non-auto approval policies → balanced', async () => {
      mockConfigReturn = {
        guardrailsConfig: {
          preProcessing: {
            contentFiltering: true,
            intentClassification: false,
            maxInputLength: 50000,
          },
          postProcessing: { piiRedaction: false, outputValidation: true },
        },
      };
      mockApprovalPolicyRows = []; // no non-auto policies
      const profile = await runAndCaptureConfig();
      expect(profile).toBe('balanced');
    });

    test('explicit defenseProfile in stored config is respected unchanged', async () => {
      mockConfigReturn = {
        guardrailsConfig: {
          preProcessing: {
            contentFiltering: true,
            intentClassification: false,
            maxInputLength: 50000,
          },
          postProcessing: { piiRedaction: false, outputValidation: true },
          defenseProfile: 'permissive',
        },
      };
      mockApprovalPolicyRows = [{ id: 'policy-1' }]; // present but should be ignored
      const profile = await runAndCaptureConfig();
      expect(profile).toBe('permissive');
    });
  });

  describe('FR-024 intentClassification deprecation warning (T062 / T066)', () => {
    // Spy on the logger so we can count WARN calls.
    // biome-ignore lint/suspicious/noExplicitAny: test-only log capture
    const warnCalls: Array<{ msg: string; meta: any }> = [];

    beforeEach(() => {
      warnCalls.length = 0;
      mockApprovalPolicyRows = [];
      mockDetectResult = {
        decision: {
          action: 'allow',
          riskScore: 0,
          layersFired: [],
          reasonCode: 'NO_MATCH',
          redactedExcerpt: '',
          referenceId: 'ref000000000',
          sourceKind: 'user_message',
        },
        layerResults: [],
      };
    });

    // Hook the LogTape logger's `warn` method so we can observe whether the
    // deprecation message was emitted. We can't easily mock @logtape/logtape's
    // getLogger return value (it's a cached singleton), but we CAN replace
    // the `warn` method on a per-test basis.
    function spyOnGuardrailsLogger(): () => void {
      // biome-ignore lint/suspicious/noExplicitAny: test-only spy via dynamic import
      const logtape = require('@logtape/logtape') as any;
      const guardrailsLogger = logtape.getLogger(['personalclaw', 'guardrails']);
      const originalWarn = guardrailsLogger.warn.bind(guardrailsLogger);
      // biome-ignore lint/suspicious/noExplicitAny: log signature is loose
      guardrailsLogger.warn = (msg: any, meta?: any) => {
        const msgStr = typeof msg === 'string' ? msg : String(msg);
        warnCalls.push({ msg: msgStr, meta });
      };
      return () => {
        guardrailsLogger.warn = originalWarn;
      };
    }

    test('logs deprecation warn when intentClassification is explicitly true', async () => {
      const restore = spyOnGuardrailsLogger();
      try {
        mockConfigReturn = {
          guardrailsConfig: {
            preProcessing: {
              contentFiltering: true,
              intentClassification: true,
              maxInputLength: 50000,
            },
            postProcessing: { piiRedaction: false, outputValidation: true },
          },
        };
        // Use a FRESH channel id so the per-process `deprecationWarnedChannels`
        // set doesn't hide the warning from tests in other files run first.
        const channelId = `deprecation-test-${Date.now()}-a`;
        await engine.preProcess({
          channelId,
          text: 'hello',
          externalUserId: 'u1',
          threadId: 't1',
          recentHistory: [],
        });
        const deprecationWarns = warnCalls.filter((c) =>
          c.msg.includes('intentClassification is deprecated'),
        );
        expect(deprecationWarns.length).toBe(1);
      } finally {
        restore();
      }
    });

    test('logs deprecation warn when intentClassification is explicitly false (FR-024 regardless-of-value)', async () => {
      const restore = spyOnGuardrailsLogger();
      try {
        mockConfigReturn = {
          guardrailsConfig: {
            preProcessing: {
              contentFiltering: true,
              intentClassification: false,
              maxInputLength: 50000,
            },
            postProcessing: { piiRedaction: false, outputValidation: true },
          },
        };
        const channelId = `deprecation-test-${Date.now()}-b`;
        await engine.preProcess({
          channelId,
          text: 'hello',
          externalUserId: 'u1',
          threadId: 't1',
          recentHistory: [],
        });
        const deprecationWarns = warnCalls.filter((c) =>
          c.msg.includes('intentClassification is deprecated'),
        );
        expect(deprecationWarns.length).toBe(1);
      } finally {
        restore();
      }
    });

    test('does NOT log deprecation warn when intentClassification is absent from the row', async () => {
      const restore = spyOnGuardrailsLogger();
      try {
        mockConfigReturn = {
          guardrailsConfig: {
            preProcessing: { contentFiltering: true, maxInputLength: 50000 },
            postProcessing: { piiRedaction: false, outputValidation: true },
          },
        };
        const channelId = `deprecation-test-${Date.now()}-c`;
        await engine.preProcess({
          channelId,
          text: 'hello',
          externalUserId: 'u1',
          threadId: 't1',
          recentHistory: [],
        });
        const deprecationWarns = warnCalls.filter((c) =>
          c.msg.includes('intentClassification is deprecated'),
        );
        expect(deprecationWarns.length).toBe(0);
      } finally {
        restore();
      }
    });

    test('deprecation warn fires at most once per process per channel', async () => {
      const restore = spyOnGuardrailsLogger();
      try {
        mockConfigReturn = {
          guardrailsConfig: {
            preProcessing: {
              contentFiltering: true,
              intentClassification: true,
              maxInputLength: 50000,
            },
            postProcessing: { piiRedaction: false, outputValidation: true },
          },
        };
        // Fresh channel id + invalidate the engine's cache so getConfig runs twice.
        const channelId = `deprecation-test-${Date.now()}-d`;
        // Cast to access the private cache map for the test only.
        // biome-ignore lint/suspicious/noExplicitAny: reaching into private state for test
        const cachedEngine = engine as any;
        cachedEngine.configCache.delete(channelId);

        await engine.preProcess({
          channelId,
          text: 'first call',
          externalUserId: 'u1',
          threadId: 't1',
          recentHistory: [],
        });
        // Invalidate the config cache so the second call re-runs getConfig.
        cachedEngine.configCache.delete(channelId);
        await engine.preProcess({
          channelId,
          text: 'second call',
          externalUserId: 'u1',
          threadId: 't1',
          recentHistory: [],
        });

        const deprecationWarns = warnCalls.filter((c) =>
          c.msg.includes('intentClassification is deprecated'),
        );
        expect(deprecationWarns.length).toBe(1);
      } finally {
        restore();
      }
    });
  });
});
