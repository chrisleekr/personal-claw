import { describe, expect, mock, test } from 'bun:test';

mock.module('../../db', () => ({
  getDb: () => ({}),
}));

import { buildTransport, type MCPServerConfig } from '../config';

describe('buildTransport', () => {
  test('builds SSE transport from config', () => {
    const config: MCPServerConfig = {
      id: 'mcp-1',
      serverName: 'test',
      transportType: 'sse',
      serverUrl: 'https://mcp.example.com/sse',
      enabled: true,
      channelId: null,
      command: null,
      args: null,
      env: null,
      cwd: null,
    };
    const transport = buildTransport(config) as { type: string; url: string };
    expect(transport.type).toBe('sse');
    expect(transport.url).toBe('https://mcp.example.com/sse');
  });

  test('builds HTTP transport with headers', () => {
    const config: MCPServerConfig = {
      id: 'mcp-2',
      serverName: 'test',
      transportType: 'http',
      serverUrl: 'https://mcp.example.com',
      headers: { Authorization: 'Bearer token' },
      enabled: true,
      channelId: null,
      command: null,
      args: null,
      env: null,
      cwd: null,
    };
    const transport = buildTransport(config) as {
      type: string;
      url: string;
      headers?: Record<string, string>;
    };
    expect(transport.type).toBe('http');
    expect(transport.headers?.Authorization).toBe('Bearer token');
  });

  test('throws when SSE config has no serverUrl', () => {
    const config: MCPServerConfig = {
      id: 'mcp-3',
      serverName: 'test',
      transportType: 'sse',
      serverUrl: null,
      enabled: true,
      channelId: null,
      command: null,
      args: null,
      env: null,
      cwd: null,
    };
    expect(() => buildTransport(config)).toThrow('no serverUrl');
  });

  test('throws when stdio config has no command', () => {
    const config: MCPServerConfig = {
      id: 'mcp-4',
      serverName: 'test',
      transportType: 'stdio',
      serverUrl: null,
      enabled: true,
      channelId: null,
      command: null,
      args: null,
      env: null,
      cwd: null,
    };
    expect(() => buildTransport(config)).toThrow('no command');
  });

  test('builds stdio transport with command and args', () => {
    const config: MCPServerConfig = {
      id: 'mcp-5',
      serverName: 'test',
      transportType: 'stdio',
      serverUrl: null,
      enabled: true,
      channelId: null,
      command: 'npx',
      args: ['-y', '@mcp/server'],
      env: null,
      cwd: null,
    };
    const transport = buildTransport(config);
    expect(transport).toBeDefined();
  });
});
