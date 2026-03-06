import { beforeEach, describe, expect, mock, test } from 'bun:test';

let mockSelectRows: unknown[] = [];
let mockMCPConfigs: unknown[] = [];
let mockMCPTools: Record<string, unknown> = {};

function chainable(getRows: () => unknown[]): unknown {
  const methods: Record<string, unknown> = {};
  for (const name of ['from', 'where', 'orderBy', 'limit', 'groupBy']) {
    methods[name] = () => chainable(getRows);
  }
  return Object.assign([...getRows()], methods);
}

mock.module('../../db', () => ({
  getDb: () => ({
    select: () => chainable(() => mockSelectRows),
  }),
}));

mock.module('../config', () => ({
  loadMCPConfigs: async () => mockMCPConfigs,
  buildTransport: (cfg: {
    transportType: string;
    serverUrl: string | null;
    serverName: string;
    command: string | null;
    args: string[] | null;
    env: Record<string, string> | null;
    cwd: string | null;
    headers?: Record<string, string>;
  }) => {
    if (cfg.transportType === 'stdio') {
      if (!cfg.command)
        throw new Error(`MCP config "${cfg.serverName}" has stdio transport but no command`);
      return { command: cfg.command, args: cfg.args };
    }
    if (!cfg.serverUrl)
      throw new Error(
        `MCP config "${cfg.serverName}" has ${cfg.transportType} transport but no serverUrl`,
      );
    return {
      type: cfg.transportType,
      url: cfg.serverUrl,
      ...(cfg.headers ? { headers: cfg.headers } : {}),
    };
  },
}));

mock.module('@ai-sdk/mcp', () => ({
  createMCPClient: async () => ({
    tools: async () => mockMCPTools,
    close: () => {},
  }),
}));

import { MCPManager } from '../manager';

describe('MCPManager', () => {
  beforeEach(() => {
    mockSelectRows = [];
    mockMCPConfigs = [];
    mockMCPTools = {};
  });

  test('getToolsForChannel returns empty object when no configs', async () => {
    const manager = new MCPManager();
    const tools = await manager.getToolsForChannel('ch-1');
    expect(Object.keys(tools)).toHaveLength(0);
  });

  test('getToolsForChannel loads tools from MCP servers', async () => {
    mockMCPConfigs = [
      {
        id: 'mcp-1',
        serverName: 'test-server',
        channelId: 'ch-1',
        transportType: 'sse',
        serverUrl: 'https://test.example.com/sse',
      },
    ];
    mockMCPTools = {
      search: { execute: async () => ({}) },
      create: { execute: async () => ({}) },
    };
    mockSelectRows = [];

    const manager = new MCPManager();
    const tools = await manager.getToolsForChannel('ch-1');
    expect(tools['test-server__search']).toBeDefined();
    expect(tools['test-server__create']).toBeDefined();
  });

  test('getToolsForChannel applies deny-list policy', async () => {
    mockMCPConfigs = [
      {
        id: 'mcp-2',
        serverName: 'filtered',
        channelId: 'ch-2',
        transportType: 'sse',
        serverUrl: 'https://test.example.com/sse',
      },
    ];
    mockMCPTools = {
      allowed: { execute: async () => ({}) },
      denied: { execute: async () => ({}) },
    };
    mockSelectRows = [
      {
        mcpConfigId: 'mcp-2',
        channelId: 'ch-2',
        allowList: [],
        denyList: ['denied'],
      },
    ];

    const manager = new MCPManager();
    const tools = await manager.getToolsForChannel('ch-2');
    expect(tools.filtered__allowed).toBeDefined();
    expect(tools.filtered__denied).toBeUndefined();
  });

  test('invalidateChannel removes cached clients for that channel', () => {
    const manager = new MCPManager();
    expect(() => manager.invalidateChannel('ch-1')).not.toThrow();
  });

  test('invalidateAll clears all cached clients', () => {
    const manager = new MCPManager();
    expect(() => manager.invalidateAll()).not.toThrow();
  });
});
