import { type ToolSet, tool } from 'ai';
import { z } from 'zod';
import type { Sandbox } from './types';

export function getSandboxTools(sandbox: Sandbox): ToolSet {
  return {
    sandbox_exec: tool({
      description:
        'Execute a single shell command in the isolated sandbox workspace (/workspace). ' +
        'Runs ONE command per call — shell chaining (&&, ||, ;) and pipes (|) are blocked. ' +
        'For multi-step tasks, make separate sequential calls. ' +
        'Output is truncated at ~10 KB; redirect large output to a file and read it with sandbox_read_file.',
      inputSchema: z.object({
        command: z
          .string()
          .describe(
            'A single shell command to execute. Only pre-approved binaries are allowed; ' +
              'the error message lists permitted commands if one is blocked. ' +
              'Examples: "git clone https://github.com/org/repo.git", "python3 script.py", "ls -la src/"',
          ),
      }),
      execute: async ({ command }) => {
        const result = await sandbox.exec(command);
        return {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        };
      },
    }),

    sandbox_write_file: tool({
      description:
        'Write or create a file in the sandbox workspace. ' +
        'Path is relative to /workspace. Parent directories are created automatically. ' +
        'Prefer this over echo/redirection in sandbox_exec — it handles any content length and avoids quoting issues.',
      inputSchema: z.object({
        path: z
          .string()
          .describe('Relative path within /workspace (e.g. "src/main.py", "config.json")'),
        content: z.string().describe('The full file content to write'),
      }),
      execute: async ({ path, content }) => {
        try {
          await sandbox.writeFile(path, content);
          return { success: true, path };
        } catch (error) {
          return { error: true, message: (error as Error).message };
        }
      },
    }),

    sandbox_read_file: tool({
      description:
        'Read a file from the sandbox workspace. ' +
        'Path is relative to /workspace. Useful for reading command output redirected to a file or inspecting source code.',
      inputSchema: z.object({
        path: z
          .string()
          .describe('Relative path within /workspace (e.g. "src/main.py", "output.log")'),
      }),
      execute: async ({ path }) => {
        try {
          const content = await sandbox.readFile(path);
          return { content };
        } catch (error) {
          return { error: true, message: (error as Error).message };
        }
      },
    }),

    sandbox_list_files: tool({
      description:
        'List files and directories in the sandbox workspace. ' +
        'Path is relative to /workspace. Defaults to the workspace root.',
      inputSchema: z.object({
        path: z.string().default('.').describe('Relative directory path (default: workspace root)'),
        recursive: z
          .boolean()
          .default(false)
          .describe('If true, list files recursively including subdirectories'),
      }),
      execute: async ({ path, recursive }) => {
        try {
          const entries = await sandbox.listFiles(path, recursive);
          return { entries };
        } catch (error) {
          return { error: true, message: (error as Error).message };
        }
      },
    }),

    sandbox_workspace_info: tool({
      description:
        'Get workspace status: path, root-level files, and sandbox id. ' +
        'Call this to orient yourself at the start of a task or to check what exists from previous turns.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const files = await sandbox.listFiles('.', false);
          return {
            workspacePath: sandbox.workspacePath,
            id: sandbox.id,
            files,
          };
        } catch (error) {
          return {
            workspacePath: sandbox.workspacePath,
            id: sandbox.id,
            files: [],
            error: (error as Error).message,
          };
        }
      },
    }),
  };
}
