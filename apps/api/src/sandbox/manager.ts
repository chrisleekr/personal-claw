import { getLogger } from '@logtape/logtape';
import type { SandboxConfig } from '@personalclaw/shared';
import { BubblewrapProvider } from './bubblewrap';
import { DirectProvider } from './direct';
import type { CreateSandboxOptions, Sandbox, SandboxProvider } from './types';

const logger = getLogger(['personalclaw', 'sandbox', 'manager']);

const SANDBOX_TTL_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes

interface SandboxEntry {
  sandbox: Sandbox;
  channelId: string;
  createdAt: number;
  lastAccessedAt: number;
}

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  allowedCommands: [
    'bash',
    'sh',
    'git',
    'node',
    'bun',
    'python3',
    'pip',
    'aws',
    'gh',
    'curl',
    'jq',
    'cat',
    'ls',
    'grep',
    'find',
    'head',
    'tail',
    'wc',
    'mkdir',
    'cp',
    'mv',
    'touch',
    'echo',
  ],
  deniedPatterns: ['rm -rf /', 'mkfs', 'dd if='],
  maxExecutionTimeS: 60,
  maxWorkspaceSizeMb: 256,
  networkAccess: true,
  gitTokenEnvVar: null,
};

export class SandboxManager {
  private provider: SandboxProvider | null = null;
  private readonly sandboxes = new Map<string, SandboxEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  async initialize(): Promise<void> {
    const bwrap = new BubblewrapProvider();
    if (await bwrap.isAvailable()) {
      this.provider = bwrap;
      logger.info`Sandbox provider: bubblewrap (full isolation)`;
    } else {
      this.provider = new DirectProvider();
      logger.warn`bubblewrap not available, using direct provider (reduced isolation). Install bubblewrap for production use.`;
    }

    this.cleanupTimer = setInterval(() => this.cleanupExpired(), CLEANUP_INTERVAL_MS);
  }

  async getOrCreate(
    channelId: string,
    threadId: string,
    config: SandboxConfig,
    env?: Record<string, string>,
  ): Promise<Sandbox> {
    const key = this.sandboxKey(channelId, threadId);
    const existing = this.sandboxes.get(key);

    if (existing) {
      existing.lastAccessedAt = Date.now();
      return existing.sandbox;
    }

    if (!this.provider) {
      throw new Error('SandboxManager not initialized — call initialize() first');
    }

    const options: CreateSandboxOptions = { channelId, threadId, config, env };
    const sandbox = await this.provider.create(options);

    this.sandboxes.set(key, {
      sandbox,
      channelId,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    });

    logger.info('Sandbox registered', {
      sandboxId: sandbox.id,
      channelId,
      threadId,
      provider: this.provider.name,
      activeSandboxes: this.sandboxes.size,
    });

    return sandbox;
  }

  async destroy(channelId: string, threadId: string): Promise<void> {
    const key = this.sandboxKey(channelId, threadId);
    const entry = this.sandboxes.get(key);
    if (!entry) return;

    this.sandboxes.delete(key);
    await entry.sandbox.destroy();
  }

  async destroyAll(): Promise<void> {
    const entries = Array.from(this.sandboxes.values());
    this.sandboxes.clear();

    await Promise.allSettled(entries.map((e) => e.sandbox.destroy()));
    logger.info`All sandboxes destroyed (${entries.length} total)`;
  }

  get activeCount(): number {
    return this.sandboxes.size;
  }

  getProviderName(): string {
    return this.provider?.name ?? 'none';
  }

  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private sandboxKey(channelId: string, threadId: string): string {
    return `${channelId}::${threadId}`;
  }

  private cleanupExpired(): void {
    const now = Date.now();
    const expired: string[] = [];

    for (const [key, entry] of this.sandboxes) {
      if (now - entry.lastAccessedAt > SANDBOX_TTL_MS) {
        expired.push(key);
      }
    }

    for (const key of expired) {
      const entry = this.sandboxes.get(key);
      if (entry) {
        this.sandboxes.delete(key);
        entry.sandbox.destroy().catch((err) => {
          logger.warn('Failed to destroy expired sandbox', {
            sandboxId: entry.sandbox.id,
            error: (err as Error).message,
          });
        });
      }
    }

    if (expired.length > 0) {
      logger.info('Expired sandboxes cleaned up', {
        count: expired.length,
        remaining: this.sandboxes.size,
      });
    }
  }
}
