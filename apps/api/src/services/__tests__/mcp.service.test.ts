import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { NotFoundError } from '../../errors/app-error';

const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';

const MOCK_MCP_CONFIG = {
  id: 'mcp-001',
  serverName: 'test-server',
  transportType: 'sse',
  serverUrl: 'https://mcp.example.com',
  headers: null,
  command: null,
  args: null,
  env: null,
  cwd: null,
  enabled: true,
  channelId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const MOCK_TOOL_POLICY = {
  id: 'tp-001',
  mcpConfigId: 'mcp-001',
  channelId: CHANNEL_ID,
  denyList: ['dangerous_tool'],
  allowList: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

let mockSelectRows: unknown[] = [];
let mockInsertRows: unknown[] = [];
let mockUpdateRows: unknown[] = [];
let mockDeleteRows: unknown[] = [];

function chainable(getRows: () => unknown[]): unknown {
  const methods: Record<string, unknown> = {};
  for (const name of ['from', 'where', 'orderBy', 'limit', 'groupBy', 'returning']) {
    methods[name] = () => chainable(getRows);
  }
  return Object.assign([...getRows()], methods);
}

mock.module('../../db', () => ({
  getDb: () => ({
    select: () => chainable(() => mockSelectRows),
    insert: () => ({
      values: () => ({
        returning: () => [...mockInsertRows],
      }),
    }),
    update: () => ({
      set: () => chainable(() => mockUpdateRows),
    }),
    delete: () => chainable(() => mockDeleteRows),
  }),
}));

mock.module('../../config/hot-reload', () => ({
  emitConfigChange: () => {},
}));

mock.module('../../mcp/config', () => ({
  buildTransport: () => ({}),
}));

import { MCPService, updateMCPConfigSchema } from '../mcp.service';

describe('MCPService', () => {
  let service: MCPService;

  beforeEach(() => {
    service = new MCPService();
    mockSelectRows = [];
    mockInsertRows = [];
    mockUpdateRows = [];
    mockDeleteRows = [];
  });

  afterEach(() => {
    mockSelectRows = [];
    mockInsertRows = [];
    mockUpdateRows = [];
    mockDeleteRows = [];
  });

  describe('listGlobal', () => {
    test('returns global MCP configs', async () => {
      mockSelectRows = [MOCK_MCP_CONFIG];
      const result = await service.listGlobal();
      expect(result).toHaveLength(1);
    });

    test('returns empty when no configs', async () => {
      mockSelectRows = [];
      const result = await service.listGlobal();
      expect(result).toHaveLength(0);
    });
  });

  describe('listByChannel', () => {
    test('returns configs for channel and global', async () => {
      mockSelectRows = [
        MOCK_MCP_CONFIG,
        { ...MOCK_MCP_CONFIG, id: 'mcp-002', channelId: CHANNEL_ID },
      ];
      const result = await service.listByChannel(CHANNEL_ID);
      expect(result).toHaveLength(2);
    });
  });

  describe('create', () => {
    test('creates and returns new config', async () => {
      mockInsertRows = [MOCK_MCP_CONFIG];
      const result = await service.create({
        serverName: 'test-server',
        transportType: 'sse',
        serverUrl: 'https://mcp.example.com',
        channelId: null,
      });
      expect(result.serverName).toBe('test-server');
    });
  });

  describe('update', () => {
    test('updates and returns config', async () => {
      mockUpdateRows = [{ ...MOCK_MCP_CONFIG, serverName: 'renamed' }];
      const result = await service.update('mcp-001', { serverName: 'renamed' });
      expect(result.serverName).toBe('renamed');
    });

    test('throws NotFoundError when config not found', async () => {
      mockUpdateRows = [];
      expect(service.update('nonexistent', { serverName: 'x' })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  describe('delete', () => {
    test('deletes config successfully', async () => {
      mockDeleteRows = [MOCK_MCP_CONFIG];
      await expect(service.delete('mcp-001')).resolves.toBeUndefined();
    });

    test('throws NotFoundError when config not found', async () => {
      mockDeleteRows = [];
      expect(service.delete('nonexistent')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('getToolPolicy', () => {
    test('returns deny list when policy exists', async () => {
      mockSelectRows = [MOCK_TOOL_POLICY];
      const result = await service.getToolPolicy('mcp-001', CHANNEL_ID);
      expect(result.disabledTools).toEqual(['dangerous_tool']);
    });

    test('returns empty array when no policy exists', async () => {
      mockSelectRows = [];
      const result = await service.getToolPolicy('mcp-001', CHANNEL_ID);
      expect(result.disabledTools).toEqual([]);
    });

    test('handles null channelId for global policy', async () => {
      mockSelectRows = [];
      const result = await service.getToolPolicy('mcp-001', null);
      expect(result.disabledTools).toEqual([]);
    });
  });

  describe('upsertToolPolicy', () => {
    test('creates new policy when none exists', async () => {
      mockSelectRows = [];
      mockInsertRows = [MOCK_TOOL_POLICY];
      const result = await service.upsertToolPolicy('mcp-001', CHANNEL_ID, ['tool_a']);
      expect(result).toBeDefined();
    });

    test('updates existing policy', async () => {
      mockSelectRows = [MOCK_TOOL_POLICY];
      mockUpdateRows = [{ ...MOCK_TOOL_POLICY, denyList: ['tool_b'] }];
      const result = await service.upsertToolPolicy('mcp-001', CHANNEL_ID, ['tool_b']);
      expect(result).toBeDefined();
    });
  });

  describe('updateMCPConfigSchema', () => {
    test('accepts valid partial update', () => {
      const result = updateMCPConfigSchema.parse({ serverName: 'updated' });
      expect(result.serverName).toBe('updated');
    });

    test('accepts empty object', () => {
      const result = updateMCPConfigSchema.parse({});
      expect(result).toBeDefined();
    });

    test('rejects empty serverName', () => {
      expect(() => updateMCPConfigSchema.parse({ serverName: '' })).toThrow();
    });

    test('rejects invalid transportType', () => {
      expect(() => updateMCPConfigSchema.parse({ transportType: 'grpc' })).toThrow();
    });

    test('accepts valid transport types', () => {
      for (const t of ['sse', 'http', 'stdio']) {
        const result = updateMCPConfigSchema.parse({ transportType: t });
        expect(result.transportType).toBe(t);
      }
    });
  });
});
