import { describe, expect, mock, test } from 'bun:test';

// The tool registry self-test instantiates real tool providers and collects
// tool names. Some providers indirectly import modules that touch the database
// or external services. We mock those at the top of the file BEFORE importing
// the system under test, per the bun mock-isolation pattern in
// `apps/api/scripts/test-isolated.ts`.

mock.module('../../db', () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({ values: () => Promise.resolve() }),
  }),
}));

mock.module('../../redis', () => ({
  isRedisAvailable: () => false,
  getRedis: () => null,
}));

mock.module('../../memory/embeddings', () => ({
  generateEmbedding: async () => new Array(1024).fill(0),
}));

mock.module('../../config', () => ({
  config: {
    OLLAMA_BASE_URL: 'http://localhost:11434/api',
    EMBEDDING_PROVIDER: 'openai',
  },
}));

mock.module('../../channels/config-cache', () => ({
  getCachedConfig: async () => null,
  invalidateConfig: () => {},
}));

import { TOOL_TRUST_MAP, TOOL_TRUST_REGISTRY } from '../tool-trust';

describe('tool-trust self-test (FR-031)', () => {
  test('every entry in TOOL_TRUST_REGISTRY has a non-empty justification', () => {
    for (const entry of TOOL_TRUST_REGISTRY) {
      expect(entry.toolName.length).toBeGreaterThan(0);
      expect(entry.justification.length).toBeGreaterThan(10);
      expect(['system_generated', 'already_detected', 'external_untrusted', 'mixed']).toContain(
        entry.category,
      );
    }
  });

  test('TOOL_TRUST_MAP is built from TOOL_TRUST_REGISTRY without duplicates', () => {
    expect(TOOL_TRUST_MAP.size).toBe(TOOL_TRUST_REGISTRY.length);
  });

  test('every statically-registered tool from every ToolProvider has a trust entry', async () => {
    // Collect all static tool names by instantiating each provider with stub
    // context. We deliberately avoid the MCP provider here because MCP tools
    // are dynamic (per-channel, loaded from the database) and are handled by
    // the default-untrusted fallback in `getToolTrustCategory()` per FR-030
    // and research.md R9.
    const { getMemoryTools } = await import('../../memory/tools');
    const { getIdentityTools } = await import('../../identity/tools');
    const { getCLITools } = await import('../../cli/tools');
    const { getBrowserTools } = await import('../../browser/tools');
    const { getScheduleTools } = await import('../../cron/tools');
    const { getSubAgentTools } = await import('../sub-agent-tools');

    const allToolNames = new Set<string>();

    const collect = (toolset: Record<string, unknown>) => {
      for (const name of Object.keys(toolset)) allToolNames.add(name);
    };

    collect(getMemoryTools('channel-test', 'user-test', 'thread-test'));
    collect(getIdentityTools('channel-test', 'user-test', 'thread-test'));
    collect(getCLITools());
    collect(getBrowserTools());
    collect(getScheduleTools('channel-test'));
    collect(getSubAgentTools('channel-test'));

    // confirm_plan is injected by ApprovalGateway.getConfirmPlanTool() and is
    // also part of the registry; add it manually because it is not produced
    // by a ToolProvider.
    allToolNames.add('confirm_plan');

    // The sandbox tools are loaded at runtime via createSandboxStage when a
    // sandbox is enabled. Their names are stable; add them so the self-test
    // covers them too.
    allToolNames.add('sandbox_exec');
    allToolNames.add('sandbox_write_file');
    allToolNames.add('sandbox_read_file');
    allToolNames.add('sandbox_list_files');
    allToolNames.add('sandbox_workspace_info');

    // Every collected tool name MUST appear in the trust registry. If a new
    // tool is added without a trust decision, this test fails loud.
    const missing: string[] = [];
    for (const name of allToolNames) {
      if (!TOOL_TRUST_MAP.has(name)) {
        missing.push(name);
      }
    }

    expect(missing).toEqual([]);
  });

  test('the registry has no orphan entries (every entry is a real tool)', async () => {
    // Inverse direction: ensure no entry in the registry is for a non-existent
    // tool. This catches typos and stale registry rows.
    const { getMemoryTools } = await import('../../memory/tools');
    const { getIdentityTools } = await import('../../identity/tools');
    const { getCLITools } = await import('../../cli/tools');
    const { getBrowserTools } = await import('../../browser/tools');
    const { getScheduleTools } = await import('../../cron/tools');
    const { getSubAgentTools } = await import('../sub-agent-tools');

    const realTools = new Set<string>([
      ...Object.keys(getMemoryTools('c', 'u', 't')),
      ...Object.keys(getIdentityTools('c', 'u', 't')),
      ...Object.keys(getCLITools()),
      ...Object.keys(getBrowserTools()),
      ...Object.keys(getScheduleTools('c')),
      ...Object.keys(getSubAgentTools('c')),
      'confirm_plan',
      'sandbox_exec',
      'sandbox_write_file',
      'sandbox_read_file',
      'sandbox_list_files',
      'sandbox_workspace_info',
    ]);

    const orphans: string[] = [];
    for (const entry of TOOL_TRUST_REGISTRY) {
      if (!realTools.has(entry.toolName)) {
        orphans.push(entry.toolName);
      }
    }

    expect(orphans).toEqual([]);
  });
});
