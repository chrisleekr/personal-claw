import { describe, expect, mock, test } from 'bun:test';

const mockTool = { type: 'tool' as const, execute: async () => ({}), parameters: {} };

mock.module('../../memory/tools', () => ({
  getMemoryTools: () => ({ memory_save: mockTool, memory_search: mockTool, memory_list: mockTool }),
}));

mock.module('../../identity/tools', () => ({
  getIdentityTools: () => ({ identity_get: mockTool, identity_set: mockTool }),
}));

mock.module('../../cli/tools', () => ({
  getCLITools: () => ({ aws_cli: mockTool, github_cli: mockTool, curl_fetch: mockTool }),
}));

mock.module('../../browser/tools', () => ({
  getBrowserTools: () => ({
    browser_screenshot: mockTool,
    browser_scrape: mockTool,
    browser_fill: mockTool,
  }),
}));

mock.module('../../cron/tools', () => ({
  getScheduleTools: () => ({
    schedule_list: mockTool,
    schedule_create: mockTool,
    schedule_update: mockTool,
    schedule_delete: mockTool,
  }),
}));

mock.module('../sub-agent-tools', () => ({
  getSubAgentTools: () => ({ spawn_subtask: mockTool, get_subtask_result: mockTool }),
}));

import {
  BrowserToolProvider,
  CLIToolProvider,
  IdentityToolProvider,
  MCPToolProvider,
  MemoryToolProvider,
  ScheduleToolProvider,
  SubAgentToolProvider,
} from '../tool-providers';

const ctx = { channelId: 'ch-1', userId: 'u-1', threadId: 't-1' };

describe('MemoryToolProvider', () => {
  const provider = new MemoryToolProvider();

  test('has name "memory"', () => {
    expect(provider.name).toBe('memory');
  });

  test('returns memory tools', async () => {
    const tools = await provider.getTools(ctx);
    expect(Object.keys(tools)).toContain('memory_save');
    expect(Object.keys(tools)).toContain('memory_search');
  });

  test('reports safe tool names', () => {
    const safeNames = provider.getSafeToolNames?.() ?? [];
    expect(safeNames).toContain('memory_search');
  });
});

describe('IdentityToolProvider', () => {
  const provider = new IdentityToolProvider();

  test('has name "identity"', () => {
    expect(provider.name).toBe('identity');
  });

  test('returns identity tools', async () => {
    const tools = await provider.getTools(ctx);
    expect(Object.keys(tools)).toContain('identity_get');
  });

  test('reports safe tool names', () => {
    const safeNames = provider.getSafeToolNames?.() ?? [];
    expect(safeNames).toContain('identity_get');
  });
});

describe('CLIToolProvider', () => {
  const provider = new CLIToolProvider();

  test('has name "cli"', () => {
    expect(provider.name).toBe('cli');
  });

  test('returns CLI tools', async () => {
    const tools = await provider.getTools();
    expect(Object.keys(tools).length).toBeGreaterThan(0);
  });
});

describe('BrowserToolProvider', () => {
  const provider = new BrowserToolProvider();

  test('has name "browser"', () => {
    expect(provider.name).toBe('browser');
  });
});

describe('ScheduleToolProvider', () => {
  const provider = new ScheduleToolProvider();

  test('has name "schedules"', () => {
    expect(provider.name).toBe('schedules');
  });
});

describe('SubAgentToolProvider', () => {
  const provider = new SubAgentToolProvider();

  test('has name "sub-agents"', () => {
    expect(provider.name).toBe('sub-agents');
  });

  test('returns sub-agent tools', async () => {
    const tools = await provider.getTools(ctx);
    expect(Object.keys(tools)).toContain('spawn_subtask');
    expect(Object.keys(tools)).toContain('get_subtask_result');
  });
});

describe('MCPToolProvider', () => {
  test('has name "mcp"', () => {
    const mockManager = { getTools: async () => ({}) } as unknown;
    const provider = new MCPToolProvider(mockManager as never);
    expect(provider.name).toBe('mcp');
  });
});
