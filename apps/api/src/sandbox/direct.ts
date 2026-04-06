import { type Dirent, readdirSync, statSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getLogger } from '@logtape/logtape';
import type { SandboxConfig } from '@personalclaw/shared';
import {
  buildSandboxEnv,
  SandboxCommandValidator,
  validateGitTokenEnvVar,
  validateSandboxPath,
} from './security';
import type {
  CreateSandboxOptions,
  ExecOptions,
  ExecResult,
  FileEntry,
  Sandbox,
  SandboxProvider,
} from './types';

const logger = getLogger(['personalclaw', 'sandbox', 'direct']);

const MAX_OUTPUT_BYTES = 10_240;

function truncate(text: string, maxBytes: number): string {
  if (text.length <= maxBytes) return text;
  return `${text.slice(0, maxBytes)}\n... [truncated at ${maxBytes} bytes]`;
}

/**
 * DirectSandbox provides workspace isolation via temp directories
 * but no namespace isolation. Used on macOS where bubblewrap is unavailable.
 */
class DirectSandbox implements Sandbox {
  readonly id: string;
  readonly workspacePath: string;
  private readonly config: SandboxConfig;
  private readonly validator: SandboxCommandValidator;
  private readonly envVars: Record<string, string>;
  private destroyed = false;

  constructor(
    id: string,
    workspacePath: string,
    config: SandboxConfig,
    env: Record<string, string>,
  ) {
    this.id = id;
    this.workspacePath = workspacePath;
    this.config = config;
    this.validator = new SandboxCommandValidator(config);
    this.envVars = env;
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    this.ensureAlive();

    const validation = this.validator.validateCommand(command);
    if (!validation.valid) {
      return { exitCode: 1, stdout: '', stderr: `Blocked: ${validation.reason}` };
    }

    const timeoutMs = options?.timeoutMs ?? this.config.maxExecutionTimeS * 1000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const env: Record<string, string> = {
      ...buildSandboxEnv(this.envVars, options?.env),
      HOME: this.workspacePath,
    };

    try {
      const proc = Bun.spawn(['sh', '-c', command], {
        cwd: this.workspacePath,
        env,
        stdout: 'pipe',
        stderr: 'pipe',
        signal: controller.signal,
      });

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      const exitCode = await proc.exited;

      logger.debug('Direct sandbox exec completed', {
        sandboxId: this.id,
        command,
        exitCode,
        stdoutLen: stdout.length,
        stderrLen: stderr.length,
      });

      return {
        exitCode,
        stdout: truncate(stdout, MAX_OUTPUT_BYTES),
        stderr: truncate(stderr, MAX_OUTPUT_BYTES),
      };
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        return {
          exitCode: 124,
          stdout: '',
          stderr: `Command timed out after ${timeoutMs}ms`,
        };
      }
      return { exitCode: 1, stdout: '', stderr: (error as Error).message };
    } finally {
      clearTimeout(timer);
    }
  }

  async writeFile(relativePath: string, content: string): Promise<void> {
    this.ensureAlive();

    const validation = validateSandboxPath(relativePath, this.workspacePath);
    if (!validation.valid) {
      throw new Error(`Invalid path: ${validation.reason}`);
    }

    const fullPath = resolve(this.workspacePath, relativePath);
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    await mkdir(dir, { recursive: true });
    await writeFile(fullPath, content, 'utf-8');
  }

  async readFile(relativePath: string): Promise<string> {
    this.ensureAlive();

    const validation = validateSandboxPath(relativePath, this.workspacePath);
    if (!validation.valid) {
      throw new Error(`Invalid path: ${validation.reason}`);
    }

    const fullPath = resolve(this.workspacePath, relativePath);
    return readFile(fullPath, 'utf-8');
  }

  async listFiles(relativePath = '.', recursive = false): Promise<FileEntry[]> {
    this.ensureAlive();

    const validation = validateSandboxPath(relativePath, this.workspacePath);
    if (!validation.valid) {
      throw new Error(`Invalid path: ${validation.reason}`);
    }

    const fullPath = resolve(this.workspacePath, relativePath);
    return collectEntries(fullPath, this.workspacePath, recursive);
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;

    try {
      await rm(this.workspacePath, { recursive: true, force: true });
      logger.info`Sandbox ${this.id} destroyed`;
    } catch (error) {
      logger.warn('Failed to clean up sandbox workspace', {
        sandboxId: this.id,
        error: (error as Error).message,
      });
    }
  }

  private ensureAlive(): void {
    if (this.destroyed) {
      throw new Error(`Sandbox ${this.id} has been destroyed`);
    }
  }
}

function collectEntries(dirPath: string, workspacePath: string, recursive: boolean): FileEntry[] {
  const entries: FileEntry[] = [];

  let items: Dirent[];
  try {
    items = readdirSync(dirPath, { withFileTypes: true }) as Dirent[];
  } catch {
    return entries;
  }

  for (const item of items) {
    const name = String(item.name);
    const fullPath = join(dirPath, name);
    const relativePath = fullPath.slice(workspacePath.length + 1);
    const isDir = item.isDirectory();
    let size = 0;
    try {
      if (!isDir) size = statSync(fullPath).size;
    } catch {
      /* ignore stat errors */
    }

    entries.push({ name, path: relativePath, isDirectory: isDir, size });

    if (recursive && isDir) {
      entries.push(...collectEntries(fullPath, workspacePath, true));
    }
  }

  return entries;
}

export class DirectProvider implements SandboxProvider {
  readonly name = 'direct';

  async create(options: CreateSandboxOptions): Promise<Sandbox> {
    validateGitTokenEnvVar(options.config.gitTokenEnvVar);

    const sandboxId = `${options.channelId}-${options.threadId}-${Date.now()}`;
    const workspacePath = join(tmpdir(), 'personalclaw-sandbox', sandboxId, 'workspace');
    await mkdir(workspacePath, { recursive: true });

    const env: Record<string, string> = { ...options.env };

    if (options.config.gitTokenEnvVar) {
      const tokenValue = Bun.env[options.config.gitTokenEnvVar];
      if (tokenValue) {
        env.GH_TOKEN = tokenValue;
        env.GITHUB_TOKEN = tokenValue;
      }
    }

    logger.info('Sandbox created (direct mode, reduced isolation)', {
      sandboxId,
      channelId: options.channelId,
      threadId: options.threadId,
      provider: this.name,
    });

    return new DirectSandbox(sandboxId, workspacePath, options.config, env);
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}
