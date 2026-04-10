import { describe, expect, mock, test } from 'bun:test';

// Mock the db module BEFORE importing the system under test so the real
// Drizzle instance is never constructed.
type OverrideRow = { overrideKind: string; targetKey: string };
let mockOverrides: OverrideRow[] = [];

mock.module('../../../db', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: async () => mockOverrides,
      }),
    }),
  }),
}));

import { loadAdversarialCorpus } from '@personalclaw/shared';
import { asInjectionCorpus, loadMergedCorpus } from '../corpus-loader';

describe('loadMergedCorpus (FR-032, FR-033)', () => {
  test('returns the full base corpus when no overrides exist', async () => {
    mockOverrides = [];
    const merged = await loadMergedCorpus('test-channel-1');
    const base = loadAdversarialCorpus();
    expect(merged.schemaVersion).toBe(base.schemaVersion);
    expect(merged.signatures.length).toBe(base.signatures.length);
    expect(merged.suppressedIds).toHaveLength(0);
  });

  test('allowlist override suppresses the named base signature', async () => {
    const base = loadAdversarialCorpus();
    const targetId = base.signatures[0].id;
    mockOverrides = [{ overrideKind: 'allowlist_signature', targetKey: targetId }];

    const merged = await loadMergedCorpus('test-channel-2');

    expect(merged.suppressedIds).toEqual([targetId]);
    expect(merged.signatures.some((s) => s.id === targetId)).toBe(false);
    expect(merged.signatures.length).toBe(base.signatures.length - 1);
  });

  test('block_phrase override adds a channel-specific signature', async () => {
    mockOverrides = [
      {
        overrideKind: 'block_phrase',
        targetKey: 'internal_project_codename_foo',
      },
    ];

    const merged = await loadMergedCorpus('test-channel-3');
    const base = loadAdversarialCorpus();

    expect(merged.signatures.length).toBe(base.signatures.length + 1);
    const added = merged.signatures.find((s) => s.text === 'internal_project_codename_foo');
    expect(added).toBeDefined();
    expect(added?.severity).toBe('high');
    expect(added?.category).toBe('channel_block_override');
  });

  test('combined allowlist + block_phrase overrides', async () => {
    const base = loadAdversarialCorpus();
    const toSuppress = base.signatures[0].id;
    mockOverrides = [
      { overrideKind: 'allowlist_signature', targetKey: toSuppress },
      { overrideKind: 'block_phrase', targetKey: 'secret_phrase_x' },
    ];

    const merged = await loadMergedCorpus('test-channel-4');
    expect(merged.signatures.length).toBe(base.signatures.length); // -1 +1
    expect(merged.signatures.some((s) => s.id === toSuppress)).toBe(false);
    expect(merged.signatures.some((s) => s.text === 'secret_phrase_x')).toBe(true);
  });

  test('trust_mcp_tool overrides are ignored by the corpus loader', async () => {
    mockOverrides = [{ overrideKind: 'trust_mcp_tool', targetKey: 'custom_mcp_tool' }];
    const merged = await loadMergedCorpus('test-channel-5');
    const base = loadAdversarialCorpus();
    expect(merged.signatures.length).toBe(base.signatures.length);
    expect(merged.suppressedIds).toHaveLength(0);
  });

  test('asInjectionCorpus produces a compatible InjectionCorpus shape', async () => {
    mockOverrides = [];
    const merged = await loadMergedCorpus('test-channel-6');
    const asCorpus = asInjectionCorpus(merged);
    expect(asCorpus.schemaVersion).toBe(merged.schemaVersion);
    expect(asCorpus.signatures.length).toBe(merged.signatures.length);
  });
});
