import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import type { SandboxConfig } from '@personalclaw/shared';
import { DirectProvider } from '../direct';

const testConfig: SandboxConfig = {
  allowedCommands: ['bash', 'sh', 'echo', 'cat', 'ls', 'mkdir', 'touch'],
  deniedPatterns: ['rm -rf /'],
  maxExecutionTimeS: 10,
  maxWorkspaceSizeMb: 64,
  networkAccess: true,
  gitTokenEnvVar: null,
};

describe('DirectProvider', () => {
  const provider = new DirectProvider();
  const sandboxes: Array<{ destroy(): Promise<void> }> = [];

  afterEach(async () => {
    for (const sb of sandboxes) {
      await sb.destroy();
    }
    sandboxes.length = 0;
  });

  test('isAvailable always returns true', async () => {
    expect(await provider.isAvailable()).toBe(true);
  });

  test('creates sandbox with workspace directory', async () => {
    const sandbox = await provider.create({
      channelId: 'ch-test',
      threadId: 'th-test',
      config: testConfig,
    });
    sandboxes.push(sandbox);

    expect(sandbox.id).toContain('ch-test');
    expect(sandbox.id).toContain('th-test');
    expect(existsSync(sandbox.workspacePath)).toBe(true);
  });

  test('exec runs commands in workspace', async () => {
    const sandbox = await provider.create({
      channelId: 'ch-exec',
      threadId: 'th-exec',
      config: testConfig,
    });
    sandboxes.push(sandbox);

    const result = await sandbox.exec('echo "hello world"');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello world');
  });

  test('exec blocks disallowed commands', async () => {
    const sandbox = await provider.create({
      channelId: 'ch-block',
      threadId: 'th-block',
      config: testConfig,
    });
    sandboxes.push(sandbox);

    const result = await sandbox.exec('wget http://example.com');
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

    await sandbox.writeFile('test.txt', 'hello sandbox');
    const content = await sandbox.readFile('test.txt');
    expect(content).toBe('hello sandbox');
  });

  test('writeFile creates parent directories', async () => {
    const sandbox = await provider.create({
      channelId: 'ch-dir',
      threadId: 'th-dir',
      config: testConfig,
    });
    sandboxes.push(sandbox);

    await sandbox.writeFile('deep/nested/dir/file.txt', 'nested content');
    const content = await sandbox.readFile('deep/nested/dir/file.txt');
    expect(content).toBe('nested content');
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

  test('listFiles recursive lists nested files', async () => {
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

  test('destroy removes workspace directory', async () => {
    const sandbox = await provider.create({
      channelId: 'ch-destroy',
      threadId: 'th-destroy',
      config: testConfig,
    });

    const path = sandbox.workspacePath;
    expect(existsSync(path)).toBe(true);

    await sandbox.destroy();
    expect(existsSync(path)).toBe(false);
  });

  test('operations after destroy throw', async () => {
    const sandbox = await provider.create({
      channelId: 'ch-dead',
      threadId: 'th-dead',
      config: testConfig,
    });

    await sandbox.destroy();
    expect(sandbox.exec('echo hi')).rejects.toThrow('destroyed');
  });
});
