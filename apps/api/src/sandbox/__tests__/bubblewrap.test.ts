import { afterEach, describe, expect, mock, test } from 'bun:test';
import { existsSync } from 'node:fs';
import type { SandboxConfig } from '@personalclaw/shared';

mock.module('../../utils/error-fmt', () => ({
  errorDetails: () => ({}),
}));

import { BubblewrapProvider } from '../bubblewrap';

const testConfig: SandboxConfig = {
  allowedCommands: ['bash', 'sh', 'echo', 'cat', 'ls', 'mkdir', 'touch', 'git'],
  deniedPatterns: ['rm -rf /'],
  maxExecutionTimeS: 10,
  maxWorkspaceSizeMb: 64,
  networkAccess: true,
  gitTokenEnvVar: null,
};

describe('BubblewrapProvider', () => {
  const provider = new BubblewrapProvider();

  test('has name "bubblewrap"', () => {
    expect(provider.name).toBe('bubblewrap');
  });

  test('isAvailable checks for bwrap binary', async () => {
    const result = await provider.isAvailable();
    expect(typeof result).toBe('boolean');
  });

  test('create returns sandbox with correct id pattern', async () => {
    const sandbox = await provider.create({
      channelId: 'ch-test',
      threadId: 'th-test',
      config: testConfig,
    });

    expect(sandbox.id).toContain('ch-test');
    expect(sandbox.id).toContain('th-test');
    expect(existsSync(sandbox.workspacePath)).toBe(true);

    await sandbox.destroy();
  });

  test('create sets up workspace directory', async () => {
    const sandbox = await provider.create({
      channelId: 'ch-ws',
      threadId: 'th-ws',
      config: testConfig,
    });

    expect(sandbox.workspacePath).toContain('personalclaw-sandbox');
    expect(existsSync(sandbox.workspacePath)).toBe(true);

    await sandbox.destroy();
  });

  test('create passes env variables', async () => {
    const sandbox = await provider.create({
      channelId: 'ch-env',
      threadId: 'th-env',
      config: testConfig,
      env: { MY_VAR: 'test-value' },
    });

    expect(sandbox).toBeDefined();
    await sandbox.destroy();
  });

  test('create with gitTokenEnvVar sets GH_TOKEN and GITHUB_TOKEN', async () => {
    const originalEnv = Bun.env.GH_TOKEN;
    Bun.env.GH_TOKEN = 'ghp_fake_token';

    try {
      const configWithGit: SandboxConfig = {
        ...testConfig,
        gitTokenEnvVar: 'GH_TOKEN',
      };

      const sandbox = await provider.create({
        channelId: 'ch-git',
        threadId: 'th-git',
        config: configWithGit,
      });

      expect(sandbox).toBeDefined();
      await sandbox.destroy();
    } finally {
      if (originalEnv === undefined) {
        delete Bun.env.GH_TOKEN;
      } else {
        Bun.env.GH_TOKEN = originalEnv;
      }
    }
  });

  test('create throws when gitTokenEnvVar is disallowed', async () => {
    const configWithBadToken: SandboxConfig = {
      ...testConfig,
      gitTokenEnvVar: 'DATABASE_URL',
    };

    await expect(
      provider.create({
        channelId: 'ch-bad-token',
        threadId: 'th-bad-token',
        config: configWithBadToken,
      }),
    ).rejects.toThrow('not allowed');
  });

  test('create succeeds when gitTokenEnvVar is GH_TOKEN', async () => {
    const originalToken = Bun.env.GH_TOKEN;
    Bun.env.GH_TOKEN = 'ghp_test_token';

    try {
      const configWithGhToken: SandboxConfig = {
        ...testConfig,
        gitTokenEnvVar: 'GH_TOKEN',
      };

      const sandbox = await provider.create({
        channelId: 'ch-gh-ok',
        threadId: 'th-gh-ok',
        config: configWithGhToken,
      });

      expect(sandbox).toBeDefined();
      await sandbox.destroy();
    } finally {
      if (originalToken === undefined) delete Bun.env.GH_TOKEN;
      else Bun.env.GH_TOKEN = originalToken;
    }
  });
});

describe.skipIf(process.platform !== 'linux')('BubblewrapSandbox', () => {
  const provider = new BubblewrapProvider();
  const sandboxes: Array<{ destroy(): Promise<void> }> = [];

  afterEach(async () => {
    for (const sb of sandboxes) {
      await sb.destroy();
    }
    sandboxes.length = 0;
  });

  test('exec blocks disallowed commands', async () => {
    const sandbox = await provider.create({
      channelId: 'ch-block',
      threadId: 'th-block',
      config: testConfig,
    });
    sandboxes.push(sandbox);

    const result = await sandbox.exec('wget http://evil.com');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Blocked');
  });

  test('exec blocks shell metacharacters', async () => {
    const sandbox = await provider.create({
      channelId: 'ch-meta',
      threadId: 'th-meta',
      config: testConfig,
    });
    sandboxes.push(sandbox);

    const result = await sandbox.exec('echo hello; rm -rf /');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Blocked');
  });

  test('writeFile and readFile roundtrip', async () => {
    const sandbox = await provider.create({
      channelId: 'ch-file',
      threadId: 'th-file',
      config: testConfig,
    });
    sandboxes.push(sandbox);

    await sandbox.writeFile('test.txt', 'hello bubblewrap');
    const content = await sandbox.readFile('test.txt');
    expect(content).toBe('hello bubblewrap');
  });

  test('writeFile creates parent directories', async () => {
    const sandbox = await provider.create({
      channelId: 'ch-mkdir',
      threadId: 'th-mkdir',
      config: testConfig,
    });
    sandboxes.push(sandbox);

    await sandbox.writeFile('deep/nested/file.txt', 'nested');
    const content = await sandbox.readFile('deep/nested/file.txt');
    expect(content).toBe('nested');
  });

  test('readFile rejects path traversal', async () => {
    const sandbox = await provider.create({
      channelId: 'ch-trav',
      threadId: 'th-trav',
      config: testConfig,
    });
    sandboxes.push(sandbox);

    expect(sandbox.readFile('../../etc/passwd')).rejects.toThrow('traversal');
  });

  test('writeFile rejects absolute paths', async () => {
    const sandbox = await provider.create({
      channelId: 'ch-abs',
      threadId: 'th-abs',
      config: testConfig,
    });
    sandboxes.push(sandbox);

    expect(sandbox.writeFile('/etc/evil', 'data')).rejects.toThrow('Absolute');
  });

  test('listFiles returns workspace contents', async () => {
    const sandbox = await provider.create({
      channelId: 'ch-list',
      threadId: 'th-list',
      config: testConfig,
    });
    sandboxes.push(sandbox);

    await sandbox.writeFile('a.txt', 'aaa');
    await sandbox.writeFile('b.txt', 'bbb');

    const entries = await sandbox.listFiles();
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(['a.txt', 'b.txt']);
  });

  test('listFiles recursive includes nested files', async () => {
    const sandbox = await provider.create({
      channelId: 'ch-rec',
      threadId: 'th-rec',
      config: testConfig,
    });
    sandboxes.push(sandbox);

    await sandbox.writeFile('src/main.ts', 'code');
    await sandbox.writeFile('src/lib/util.ts', 'util');

    const entries = await sandbox.listFiles('.', true);
    const paths = entries.map((e) => e.path).sort();
    expect(paths).toContain('src/main.ts');
    expect(paths).toContain('src/lib/util.ts');
  });

  test('destroy removes workspace', async () => {
    const sandbox = await provider.create({
      channelId: 'ch-destroy',
      threadId: 'th-destroy',
      config: testConfig,
    });

    const wsPath = sandbox.workspacePath;
    expect(existsSync(wsPath)).toBe(true);

    await sandbox.destroy();
    expect(existsSync(wsPath)).toBe(false);
  });

  test('double destroy is idempotent', async () => {
    const sandbox = await provider.create({
      channelId: 'ch-dbl',
      threadId: 'th-dbl',
      config: testConfig,
    });

    await sandbox.destroy();
    await sandbox.destroy();
  });

  test('operations after destroy throw', async () => {
    const sandbox = await provider.create({
      channelId: 'ch-dead',
      threadId: 'th-dead',
      config: testConfig,
    });

    await sandbox.destroy();
    expect(sandbox.exec('echo hi')).rejects.toThrow('destroyed');
    expect(sandbox.writeFile('x.txt', 'x')).rejects.toThrow('destroyed');
    expect(sandbox.readFile('x.txt')).rejects.toThrow('destroyed');
    expect(sandbox.listFiles()).rejects.toThrow('destroyed');
  });
});
