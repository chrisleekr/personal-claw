import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

let mockSelectRows: unknown[] = [];
let mockUpdateCalled = false;

function chainable(getRows: () => unknown[]): unknown {
  const methods: Record<string, unknown> = {};
  for (const name of ['from', 'where', 'orderBy', 'limit', 'groupBy', 'returning', 'set']) {
    methods[name] = () => chainable(getRows);
  }
  return Object.assign([...getRows()], methods);
}

mock.module('../../db', () => ({
  getDb: () => ({
    select: () => chainable(() => mockSelectRows),
    update: () => ({
      set: () => {
        mockUpdateCalled = true;
        return chainable(() => mockSelectRows);
      },
    }),
  }),
}));

mock.module('../../config/hot-reload', () => {
  const _handlers: Array<(channelId: string, changeType: string) => void> = [];
  return {
    onConfigChange: (h: (channelId: string, changeType: string) => void) => _handlers.push(h),
    emitConfigChange: (channelId: string, changeType: string) => {
      for (const h of _handlers) h(channelId, changeType);
    },
  };
});

mock.module('../../hooks/engine', () => {
  class MockHooksEngine {
    private static inst: MockHooksEngine;
    private handlers = new Map<string, Array<(ctx: unknown) => Promise<void>>>();
    static getInstance() {
      if (!MockHooksEngine.inst) MockHooksEngine.inst = new MockHooksEngine();
      return MockHooksEngine.inst;
    }
    on(event: string, handler: (ctx: unknown) => Promise<void>) {
      const existing = this.handlers.get(event) ?? [];
      existing.push(handler);
      this.handlers.set(event, existing);
    }
    async emit(event: string, ctx: unknown) {
      for (const h of this.handlers.get(event) ?? []) await h(ctx);
    }
  }
  return { HooksEngine: MockHooksEngine };
});

import { getIdentityTools } from '../tools';

describe('getIdentityTools', () => {
  const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';

  beforeEach(() => {
    mockSelectRows = [];
    mockUpdateCalled = false;
  });

  afterEach(() => {
    mockSelectRows = [];
    mockUpdateCalled = false;
  });

  test('returns identity_get, identity_set, and team_context_set tools', () => {
    const tools = getIdentityTools(CHANNEL_ID);
    expect(tools.identity_get).toBeDefined();
    expect(tools.identity_set).toBeDefined();
    expect(tools.team_context_set).toBeDefined();
  });

  test('identity_get returns channel identity', async () => {
    mockSelectRows = [
      {
        id: CHANNEL_ID,
        identityPrompt: 'I am a helpful bot.',
        teamPrompt: 'We use TypeScript.',
        autonomyLevel: 'balanced',
      },
    ];
    const tools = getIdentityTools(CHANNEL_ID);
    const result = await tools.identity_get.execute(
      {},
      { toolCallId: 'tc-1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(result.identityPrompt).toBe('I am a helpful bot.');
  });

  test('identity_set updates identity prompt', async () => {
    mockSelectRows = [
      {
        id: CHANNEL_ID,
        identityPrompt: 'Updated identity.',
      },
    ];
    const tools = getIdentityTools(CHANNEL_ID, 'user-1', 'thread-1');
    const result = await tools.identity_set.execute(
      { identityPrompt: 'Updated identity.' },
      { toolCallId: 'tc-2', messages: [], abortSignal: new AbortController().signal },
    );
    expect(mockUpdateCalled).toBe(true);
    expect(result.updated).toBe(true);
    expect(result.identityPrompt).toBe('Updated identity.');
  });
});
