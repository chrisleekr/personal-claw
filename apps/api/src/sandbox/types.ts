import type { SandboxConfig } from '@personalclaw/shared';

export interface ExecOptions {
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
}

export interface Sandbox {
  readonly id: string;
  readonly workspacePath: string;
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  writeFile(relativePath: string, content: string): Promise<void>;
  readFile(relativePath: string): Promise<string>;
  listFiles(relativePath?: string, recursive?: boolean): Promise<FileEntry[]>;
  destroy(): Promise<void>;
}

export interface CreateSandboxOptions {
  channelId: string;
  threadId: string;
  config: SandboxConfig;
  env?: Record<string, string>;
}

export interface SandboxProvider {
  readonly name: string;
  create(options: CreateSandboxOptions): Promise<Sandbox>;
  isAvailable(): Promise<boolean>;
}
