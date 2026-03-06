import { describe, expect, test } from 'bun:test';
import type { ToolSet } from 'ai';
import { type ToolContext, type ToolProvider, ToolRegistry } from '../tool-registry';

function makeProvider(name: string, tools: ToolSet, safeNames?: string[]): ToolProvider {
  return {
    name,
    getTools: async () => tools,
    getSafeToolNames: safeNames ? () => safeNames : undefined,
  };
}

describe('ToolRegistry', () => {
  const ctx: ToolContext = {
    channelId: 'ch-1',
    userId: 'user-1',
    threadId: 'thread-1',
  };

  test('register adds a provider', () => {
    const registry = new ToolRegistry();
    const provider = makeProvider('test', {});
    registry.register(provider);
    const safeNames = registry.getSafeToolNames();
    expect(safeNames).toBeDefined();
  });

  test('loadAll merges tools from all providers', async () => {
    const registry = new ToolRegistry();
    const toolA = { description: 'Tool A' };
    const toolB = { description: 'Tool B' };
    registry.register(makeProvider('provider-1', { tool_a: toolA } as unknown as ToolSet));
    registry.register(makeProvider('provider-2', { tool_b: toolB } as unknown as ToolSet));

    const tools = await registry.loadAll(ctx);
    expect(Object.keys(tools)).toContain('tool_a');
    expect(Object.keys(tools)).toContain('tool_b');
  });

  test('loadAll returns empty set when no providers', async () => {
    const registry = new ToolRegistry();
    const tools = await registry.loadAll(ctx);
    expect(Object.keys(tools)).toHaveLength(0);
  });

  test('loadAll skips failing providers gracefully', async () => {
    const registry = new ToolRegistry();
    const failingProvider: ToolProvider = {
      name: 'broken',
      getTools: async () => {
        throw new Error('Provider broken');
      },
    };
    const goodProvider = makeProvider('good', { tool_a: {} } as unknown as ToolSet);
    registry.register(failingProvider);
    registry.register(goodProvider);

    const tools = await registry.loadAll(ctx);
    expect(Object.keys(tools)).toContain('tool_a');
  });

  test('getSafeToolNames collects from all providers', () => {
    const registry = new ToolRegistry();
    registry.register(makeProvider('p1', {}, ['memory_search', 'memory_save']));
    registry.register(makeProvider('p2', {}, ['identity_get']));

    const safe = registry.getSafeToolNames();
    expect(safe.has('memory_search')).toBe(true);
    expect(safe.has('memory_save')).toBe(true);
    expect(safe.has('identity_get')).toBe(true);
  });

  test('getSafeToolNames handles providers without getSafeToolNames', () => {
    const registry = new ToolRegistry();
    registry.register(makeProvider('p1', {}));
    registry.register(makeProvider('p2', {}, ['identity_get']));

    const safe = registry.getSafeToolNames();
    expect(safe.has('identity_get')).toBe(true);
    expect(safe.size).toBe(1);
  });

  test('getSafeToolNames returns empty set when no providers', () => {
    const registry = new ToolRegistry();
    const safe = registry.getSafeToolNames();
    expect(safe.size).toBe(0);
  });

  test('later registered provider tools override earlier ones', async () => {
    const registry = new ToolRegistry();
    registry.register(makeProvider('p1', { tool_x: { v: 1 } } as unknown as ToolSet));
    registry.register(makeProvider('p2', { tool_x: { v: 2 } } as unknown as ToolSet));

    const tools = await registry.loadAll(ctx);
    expect((tools.tool_x as unknown as { v: number }).v).toBe(2);
  });
});
