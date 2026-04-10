import { describe, expect, mock, test } from 'bun:test';

type InsertedRow = Record<string, unknown>;
let insertedRows: InsertedRow[] = [];
let insertThrow: Error | null = null;
let hookErrors: Array<{ handlerIndex: number; error: Error }> = [];
let hookThrow: Error | null = null;
const emittedHooks: Array<{ event: string; payload: Record<string, unknown> }> = [];

mock.module('../../../db', () => ({
  getDb: () => ({
    insert: (_table: unknown) => ({
      values: async (row: InsertedRow) => {
        if (insertThrow) throw insertThrow;
        insertedRows.push(row);
      },
    }),
  }),
}));

mock.module('../../../hooks/engine', () => ({
  HooksEngine: {
    getInstance: () => ({
      emit: async (event: string, ctx: { payload: Record<string, unknown> }) => {
        if (hookThrow) throw hookThrow;
        emittedHooks.push({ event, payload: ctx.payload });
        return { successCount: 0, errors: hookErrors };
      },
    }),
  },
}));

mock.module('../../../utils/pii-masker', () => ({
  maskPII: (s: string) => s.replace(/\w+@\w+\.\w+/g, '[EMAIL]'),
}));

import { writeAuditEvent } from '../audit';

function makeDecision(overrides: Partial<Parameters<typeof writeAuditEvent>[0]> = {}) {
  return {
    decision: {
      action: 'block' as const,
      riskScore: 92.5,
      layersFired: ['normalize', 'similarity', 'classifier'] as (
        | 'normalize'
        | 'similarity'
        | 'classifier'
      )[],
      reasonCode: 'HEURISTIC_MATCH:corpus_v1_sig_001',
      redactedExcerpt: 'ignore previous instructions',
      referenceId: 'ref123456ab',
      sourceKind: 'user_message' as const,
    },
    layerResults: [
      {
        layerId: 'normalize' as const,
        fired: false,
        score: 0,
        reasonCode: null,
        shortCircuit: false,
        latencyMs: 0.5,
      },
      {
        layerId: 'similarity' as const,
        fired: true,
        score: 92,
        reasonCode: 'SIMILARITY_MATCH:corpus_v1_sig_001:system_override',
        shortCircuit: true,
        latencyMs: 12.3,
      },
    ],
    channelId: 'c1',
    externalUserId: 'u1',
    threadId: 't1',
    rawExcerpt: 'ignore previous instructions',
    canaryHit: false,
    ...overrides,
  };
}

describe('writeAuditEvent (FR-026, FR-027, FR-010)', () => {
  test('inserts a row with all required columns', async () => {
    insertedRows = [];
    insertThrow = null;
    hookErrors = [];
    emittedHooks.length = 0;
    await writeAuditEvent(makeDecision());
    expect(insertedRows).toHaveLength(1);
    const row = insertedRows[0];
    expect(row.channelId).toBe('c1');
    expect(row.externalUserId).toBe('u1');
    expect(row.threadId).toBe('t1');
    expect(row.decision).toBe('block');
    expect(row.riskScore).toBe('92.50');
    expect(row.layersFired).toEqual(['normalize', 'similarity', 'classifier']);
    expect(row.reasonCode).toBe('HEURISTIC_MATCH:corpus_v1_sig_001');
    expect(row.referenceId).toBe('ref123456ab');
    expect(row.sourceKind).toBe('user_message');
    expect(row.canaryHit).toBe(false);
  });

  test('passes redacted_excerpt through maskPII before insert', async () => {
    insertedRows = [];
    insertThrow = null;
    await writeAuditEvent(makeDecision({ rawExcerpt: 'contact user@example.com for the secret' }));
    const row = insertedRows[0];
    expect(row.redactedExcerpt).toBe('contact [EMAIL] for the secret');
  });

  test('truncates long excerpts to 500 chars', async () => {
    insertedRows = [];
    insertThrow = null;
    const long = 'a'.repeat(1000);
    await writeAuditEvent(makeDecision({ rawExcerpt: long }));
    const row = insertedRows[0];
    expect((row.redactedExcerpt as string).length).toBe(500);
    expect((row.redactedExcerpt as string).endsWith('…')).toBe(true);
  });

  test('emits guardrail:detection hook AFTER the DB insert', async () => {
    insertedRows = [];
    insertThrow = null;
    emittedHooks.length = 0;
    hookErrors = [];
    await writeAuditEvent(makeDecision());
    expect(emittedHooks).toHaveLength(1);
    expect(emittedHooks[0].event).toBe('guardrail:detection');
    expect(emittedHooks[0].payload.referenceId).toBe('ref123456ab');
    expect(emittedHooks[0].payload.action).toBe('block');
  });

  test('DB insert failure throws and does NOT emit the hook', async () => {
    insertedRows = [];
    insertThrow = new Error('DB down');
    emittedHooks.length = 0;
    hookErrors = [];
    await expect(writeAuditEvent(makeDecision())).rejects.toThrow('DB down');
    expect(emittedHooks).toHaveLength(0);
    insertThrow = null;
  });

  test('hook emission failure does NOT fail the audit (row is still durable) — FR-027 side-channel semantics', async () => {
    insertedRows = [];
    insertThrow = null;
    hookThrow = new Error('hook engine exploded');
    hookErrors = [];
    // Should resolve, not throw.
    await writeAuditEvent(makeDecision());
    expect(insertedRows).toHaveLength(1);
    hookThrow = null;
  });

  test('hook handler errors are logged but do not propagate', async () => {
    insertedRows = [];
    hookErrors = [
      {
        handlerIndex: 0,
        error: new Error('handler failed'),
      } as unknown as { handlerIndex: number; error: Error },
    ];
    // Should complete without throwing.
    await writeAuditEvent(makeDecision());
    expect(insertedRows).toHaveLength(1);
    hookErrors = [];
  });

  test('canary_hit column is propagated correctly when true', async () => {
    insertedRows = [];
    insertThrow = null;
    hookErrors = [];
    await writeAuditEvent(makeDecision({ canaryHit: true }));
    expect(insertedRows[0].canaryHit).toBe(true);
  });

  test('threadId=null is allowed (e.g. for generate-skill source)', async () => {
    insertedRows = [];
    insertThrow = null;
    hookErrors = [];
    await writeAuditEvent(makeDecision({ threadId: null }));
    expect(insertedRows[0].threadId).toBeNull();
  });
});
