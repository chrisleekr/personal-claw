import { type Dirent, existsSync, readdirSync, statSync } from 'node:fs';
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

const logger = getLogger(['personalclaw', 'sandbox', 'bubblewrap']);

const MAX_OUTPUT_BYTES = 10_240;
const _DEFAULT_TIMEOUT_MS = 60_000;

function truncate(text: string, maxBytes: number): string {
  if (text.length <= maxBytes) return text;
  return `${text.slice(0, maxBytes)}\n... [truncated at ${maxBytes} bytes]`;
}

/**
 * Detects which system paths exist on the host for read-only binding into bwrap.
 * Alpine and Debian-based distros have different layouts.
 */
function detectSystemBinds(): string[][] {
  const candidates = [
    '/usr',
    '/bin',
    '/sbin',
    '/lib',
    '/lib64',
    '/etc/resolv.conf',
    '/etc/ssl',
    '/etc/ca-certificates',
    '/etc/alternatives',
  ];
  return candidates.filter((p) => existsSync(p)).map((p) => ['--ro-bind', p, p]);
}

class BubblewrapSandbox implements Sandbox {
  readonly id: string;
  readonly workspacePath: string;
  private readonly config: SandboxConfig;
  private readonly validator: SandboxCommandValidator;
  private readonly envVars: Record<string, string>;
  private readonly systemBinds: string[][];
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
    this.systemBinds = detectSystemBinds();
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    this.ensureAlive();

    const validation = this.validator.validateCommand(command);
    if (!validation.valid) {
      logger.warn('Command rejected', {
        sandboxId: this.id,
        command,
        reason: validation.reason,
      });
      return { exitCode: 1, stdout: '', stderr: `Blocked: ${validation.reason}` };
    }

    const timeoutMs = options?.timeoutMs ?? this.config.maxExecutionTimeS * 1000;

    const bwrapArgs = this.buildBwrapArgs(command, options?.env);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const proc = Bun.spawn(['bwrap', ...bwrapArgs], {
        stdout: 'pipe',
        stderr: 'pipe',
        signal: controller.signal,
      });

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      const exitCode = await proc.exited;

      logger.debug('Sandbox exec completed', {
        sandboxId: this.id,
        command,
        exitCode,
        stdoutLen: stdout.length,
        stderrLen: stderr.length,
      });

      // Best-effort workspace size enforcement after each exec
      await this.checkWorkspaceSize();

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

  /**
   * Best-effort workspace size check after command execution.
   * Logs a warning if the workspace exceeds the configured limit.
   */
  private async checkWorkspaceSize(): Promise<void> {
    try {
      const maxBytes = this.config.maxWorkspaceSizeMb * 1024 * 1024;
      const proc = Bun.spawn(['du', '-sb', this.workspacePath], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const output = await new Response(proc.stdout).text();
      await proc.exited;
      const sizeStr = output.split('\t')[0];
      const size = Number.parseInt(sizeStr, 10);
      if (!Number.isNaN(size) && size > maxBytes) {
        logger.warn('Workspace size limit exceeded', {
          sandboxId: this.id,
          currentBytes: size,
          limitBytes: maxBytes,
        });
      }
    } catch {
      // Best-effort — du may not be available
    }
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

  /**
   * Builds the bwrap argument list for sandboxed command execution.
   *
   * Isolation features:
   * - PID and IPC namespace isolation (always on)
   * - Network namespace isolation via `--unshare-net` when `networkAccess` is `false`
   * - Read-only system binds and a writable host workspace bind at `/workspace`
   * - Workspace size is checked after execution via best-effort `du` (see `checkWorkspaceSize`)
   *
   * @param command - The shell command to execute inside the sandbox
   * @param extraEnv - Additional environment variables from the caller
   * @returns Array of bwrap CLI arguments
   */
  private buildBwrapArgs(command: string, extraEnv?: Record<string, string>): string[] {
    const args: string[] = [];

    for (const bind of this.systemBinds) {
      args.push(...bind);
    }

    args.push(
      '--proc',
      '/proc',
      '--dev',
      '/dev',
      '--tmpfs',
      '/tmp',
      '--bind',
      this.workspacePath,
      '/workspace',
      '--unshare-pid',
      '--unshare-ipc',
    );

    // Network isolation: disable network access when configured
    if (!this.config.networkAccess) {
      args.push('--unshare-net');
    }

    args.push(
      '--die-with-parent',
      '--new-session',
      '--chdir',
      '/workspace',
      '--setenv',
      'HOME',
      '/workspace',
      '--setenv',
      'PATH',
      '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    );

    const mergedEnv = buildSandboxEnv(this.envVars, extraEnv);
    delete mergedEnv.HOME;
    delete mergedEnv.PATH;
    mergedEnv.TMPDIR = '/tmp';
    for (const [key, value] of Object.entries(mergedEnv)) {
      args.push('--setenv', key, value);
    }

    args.push('--', 'sh', '-c', command);
    return args;
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

export class BubblewrapProvider implements SandboxProvider {
  readonly name = 'bubblewrap';

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

    logger.info('Sandbox created', {
      sandboxId,
      channelId: options.channelId,
      threadId: options.threadId,
      provider: this.name,
    });

    return new BubblewrapSandbox(sandboxId, workspacePath, options.config, env);
  }

  async isAvailable(): Promise<boolean> {
    try {
      const proc = Bun.spawn(['bwrap', '--version'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      await proc.exited;
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }
}
