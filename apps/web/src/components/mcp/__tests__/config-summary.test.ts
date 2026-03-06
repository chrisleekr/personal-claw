import { describe, expect, test } from 'bun:test';
import type { MCPConfig } from '@personalclaw/shared';
import { configSummary, parseArgs, parseKeyValue } from '../config-summary';

describe('configSummary', () => {
  test('returns command + args for stdio transport', () => {
    const config = {
      transportType: 'stdio',
      command: '/usr/bin/mcp-server',
      args: ['--port', '9000'],
    } as MCPConfig;
    expect(configSummary(config)).toBe('/usr/bin/mcp-server --port 9000');
  });

  test('returns command only when no args for stdio', () => {
    const config = {
      transportType: 'stdio',
      command: '/usr/bin/mcp-server',
      args: null,
    } as MCPConfig;
    expect(configSummary(config)).toBe('/usr/bin/mcp-server');
  });

  test('returns serverUrl for sse transport', () => {
    const config = {
      transportType: 'sse',
      serverUrl: 'https://mcp.example.com',
    } as MCPConfig;
    expect(configSummary(config)).toBe('https://mcp.example.com');
  });

  test('returns serverUrl for http transport', () => {
    const config = {
      transportType: 'http',
      serverUrl: 'https://api.example.com/mcp',
    } as MCPConfig;
    expect(configSummary(config)).toBe('https://api.example.com/mcp');
  });

  test('returns empty string when serverUrl is null for non-stdio', () => {
    const config = {
      transportType: 'sse',
      serverUrl: null,
    } as MCPConfig;
    expect(configSummary(config)).toBe('');
  });
});

describe('parseArgs', () => {
  test('returns empty array for empty string', () => {
    expect(parseArgs('')).toEqual([]);
  });

  test('returns empty array for whitespace-only', () => {
    expect(parseArgs('   ')).toEqual([]);
  });

  test('parses JSON array', () => {
    expect(parseArgs('["--port", "9000"]')).toEqual(['--port', '9000']);
  });

  test('parses newline-separated values', () => {
    expect(parseArgs('--port\n9000\n--verbose')).toEqual(['--port', '9000', '--verbose']);
  });

  test('trims whitespace from newline-separated values', () => {
    expect(parseArgs('  --port  \n  9000  ')).toEqual(['--port', '9000']);
  });

  test('filters empty lines', () => {
    expect(parseArgs('--port\n\n9000\n\n')).toEqual(['--port', '9000']);
  });

  test('converts JSON array elements to strings', () => {
    expect(parseArgs('[1, 2, 3]')).toEqual(['1', '2', '3']);
  });

  test('falls back to newline split for non-JSON', () => {
    expect(parseArgs('not-json')).toEqual(['not-json']);
  });
});

describe('parseKeyValue', () => {
  test('returns null for empty string', () => {
    expect(parseKeyValue('')).toBeNull();
  });

  test('returns null for whitespace-only', () => {
    expect(parseKeyValue('   ')).toBeNull();
  });

  test('parses single key=value', () => {
    expect(parseKeyValue('API_KEY=abc123')).toEqual({ API_KEY: 'abc123' });
  });

  test('parses multiple key=value pairs', () => {
    const result = parseKeyValue('KEY1=val1\nKEY2=val2');
    expect(result).toEqual({ KEY1: 'val1', KEY2: 'val2' });
  });

  test('trims whitespace around keys and values', () => {
    const result = parseKeyValue('  KEY  =  value  ');
    expect(result).toEqual({ KEY: 'value' });
  });

  test('handles values containing equals sign', () => {
    const result = parseKeyValue('TOKEN=abc=def=ghi');
    expect(result).toEqual({ TOKEN: 'abc=def=ghi' });
  });

  test('skips lines without equals sign', () => {
    const result = parseKeyValue('KEY=val\nno-equals-here\nKEY2=val2');
    expect(result).toEqual({ KEY: 'val', KEY2: 'val2' });
  });

  test('returns null when no valid pairs found', () => {
    expect(parseKeyValue('no-equals')).toBeNull();
  });

  test('skips entries with empty keys', () => {
    const result = parseKeyValue('=value\nKEY=val');
    expect(result).toEqual({ KEY: 'val' });
  });
});
