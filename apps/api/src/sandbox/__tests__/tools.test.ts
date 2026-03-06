import { describe, expect, mock, test } from 'bun:test';
import { getSandboxTools } from '../tools';
import type { ExecResult, FileEntry, Sandbox } from '../types';

function makeSandbox(overrides: Partial<Sandbox> = {}): Sandbox {
  return {
    id: 'sb-test-1',
    workspacePath: '/tmp/test-sandbox/workspace',
    exec: mock(
      async (): Promise<ExecResult> => ({
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
      }),
    ),
    writeFile: mock(async () => {}),
    readFile: mock(async () => 'file content'),
    listFiles: mock(
      async (): Promise<FileEntry[]> => [
        { name: 'main.ts', path: 'main.ts', isDirectory: false, size: 100 },
      ],
    ),
    destroy: mock(async () => {}),
    ...overrides,
  };
}

describe('getSandboxTools', () => {
  test('returns all expected tools', () => {
    const tools = getSandboxTools(makeSandbox());
    expect(Object.keys(tools).sort()).toEqual([
      'sandbox_exec',
      'sandbox_list_files',
      'sandbox_read_file',
      'sandbox_workspace_info',
      'sandbox_write_file',
    ]);
  });

  test('all tools have description and execute function', () => {
    const tools = getSandboxTools(makeSandbox());
    for (const [_name, t] of Object.entries(tools)) {
      const toolDef = t as { description: string; execute: (...args: never) => unknown };
      expect(typeof toolDef.description).toBe('string');
      expect(toolDef.description.length).toBeGreaterThan(0);
      expect(typeof toolDef.execute).toBe('function');
    }
  });
});

describe('sandbox_exec', () => {
  test('calls sandbox.exec with the command', async () => {
    const sandbox = makeSandbox();
    const tools = getSandboxTools(sandbox);
    const execTool = tools.sandbox_exec as {
      execute: (args: { command: string }) => Promise<unknown>;
    };

    const result = await execTool.execute({ command: 'ls -la' });

    expect(sandbox.exec).toHaveBeenCalledWith('ls -la');
    expect(result).toEqual({ exitCode: 0, stdout: 'ok', stderr: '' });
  });

  test('returns error result from sandbox', async () => {
    const sandbox = makeSandbox({
      exec: mock(
        async (): Promise<ExecResult> => ({
          exitCode: 1,
          stdout: '',
          stderr: 'Blocked: wget not allowed',
        }),
      ),
    });
    const tools = getSandboxTools(sandbox);
    const execTool = tools.sandbox_exec as {
      execute: (args: { command: string }) => Promise<unknown>;
    };

    const result = (await execTool.execute({ command: 'wget http://evil.com' })) as ExecResult;
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Blocked');
  });
});

describe('sandbox_write_file', () => {
  test('writes file and returns success', async () => {
    const sandbox = makeSandbox();
    const tools = getSandboxTools(sandbox);
    const writeTool = tools.sandbox_write_file as {
      execute: (args: { path: string; content: string }) => Promise<unknown>;
    };

    const result = (await writeTool.execute({
      path: 'src/app.ts',
      content: 'console.log("hi")',
    })) as { success: boolean; path: string };

    expect(sandbox.writeFile).toHaveBeenCalledWith('src/app.ts', 'console.log("hi")');
    expect(result.success).toBe(true);
    expect(result.path).toBe('src/app.ts');
  });

  test('returns error on write failure', async () => {
    const sandbox = makeSandbox({
      writeFile: mock(async () => {
        throw new Error('Invalid path: traversal');
      }),
    });
    const tools = getSandboxTools(sandbox);
    const writeTool = tools.sandbox_write_file as {
      execute: (args: { path: string; content: string }) => Promise<unknown>;
    };

    const result = (await writeTool.execute({
      path: '../../etc/passwd',
      content: 'evil',
    })) as { error: boolean; message: string };

    expect(result.error).toBe(true);
    expect(result.message).toContain('traversal');
  });
});

describe('sandbox_read_file', () => {
  test('reads file and returns content', async () => {
    const sandbox = makeSandbox();
    const tools = getSandboxTools(sandbox);
    const readTool = tools.sandbox_read_file as {
      execute: (args: { path: string }) => Promise<unknown>;
    };

    const result = (await readTool.execute({ path: 'main.ts' })) as { content: string };

    expect(sandbox.readFile).toHaveBeenCalledWith('main.ts');
    expect(result.content).toBe('file content');
  });

  test('returns error on read failure', async () => {
    const sandbox = makeSandbox({
      readFile: mock(async () => {
        throw new Error('ENOENT: no such file');
      }),
    });
    const tools = getSandboxTools(sandbox);
    const readTool = tools.sandbox_read_file as {
      execute: (args: { path: string }) => Promise<unknown>;
    };

    const result = (await readTool.execute({ path: 'nonexistent.txt' })) as {
      error: boolean;
      message: string;
    };

    expect(result.error).toBe(true);
    expect(result.message).toContain('ENOENT');
  });
});

describe('sandbox_list_files', () => {
  test('lists files with defaults', async () => {
    const sandbox = makeSandbox();
    const tools = getSandboxTools(sandbox);
    const listTool = tools.sandbox_list_files as {
      execute: (args: { path: string; recursive: boolean }) => Promise<unknown>;
    };

    const result = (await listTool.execute({ path: '.', recursive: false })) as {
      entries: FileEntry[];
    };

    expect(sandbox.listFiles).toHaveBeenCalledWith('.', false);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].name).toBe('main.ts');
  });

  test('lists files recursively', async () => {
    const deepEntries: FileEntry[] = [
      { name: 'src', path: 'src', isDirectory: true, size: 0 },
      { name: 'main.ts', path: 'src/main.ts', isDirectory: false, size: 50 },
    ];
    const sandbox = makeSandbox({
      listFiles: mock(async (): Promise<FileEntry[]> => deepEntries),
    });
    const tools = getSandboxTools(sandbox);
    const listTool = tools.sandbox_list_files as {
      execute: (args: { path: string; recursive: boolean }) => Promise<unknown>;
    };

    const result = (await listTool.execute({ path: '.', recursive: true })) as {
      entries: FileEntry[];
    };

    expect(sandbox.listFiles).toHaveBeenCalledWith('.', true);
    expect(result.entries).toHaveLength(2);
  });

  test('returns error on list failure', async () => {
    const sandbox = makeSandbox({
      listFiles: mock(async () => {
        throw new Error('permission denied');
      }),
    });
    const tools = getSandboxTools(sandbox);
    const listTool = tools.sandbox_list_files as {
      execute: (args: { path: string; recursive: boolean }) => Promise<unknown>;
    };

    const result = (await listTool.execute({ path: '/forbidden', recursive: false })) as {
      error: boolean;
      message: string;
    };

    expect(result.error).toBe(true);
    expect(result.message).toContain('permission denied');
  });
});

describe('sandbox_workspace_info', () => {
  test('returns workspace path and id', async () => {
    const sandbox = makeSandbox();
    const tools = getSandboxTools(sandbox);
    const infoTool = tools.sandbox_workspace_info as {
      execute: (args: Record<string, never>) => Promise<unknown>;
    };

    const result = (await infoTool.execute({})) as {
      workspacePath: string;
      id: string;
      files: FileEntry[];
    };

    expect(result.workspacePath).toBe('/tmp/test-sandbox/workspace');
    expect(result.id).toBe('sb-test-1');
    expect(result.files).toHaveLength(1);
  });

  test('returns empty files on error', async () => {
    const sandbox = makeSandbox({
      listFiles: mock(async () => {
        throw new Error('boom');
      }),
    });
    const tools = getSandboxTools(sandbox);
    const infoTool = tools.sandbox_workspace_info as {
      execute: (args: Record<string, never>) => Promise<unknown>;
    };

    const result = (await infoTool.execute({})) as {
      workspacePath: string;
      id: string;
      files: FileEntry[];
      error: string;
    };

    expect(result.id).toBe('sb-test-1');
    expect(result.files).toEqual([]);
    expect(result.error).toBe('boom');
  });
});
