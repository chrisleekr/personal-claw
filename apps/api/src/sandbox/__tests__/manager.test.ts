import { afterEach, describe, expect, test } from 'bun:test';
import type { SandboxConfig } from '@personalclaw/shared';
import { DEFAULT_SANDBOX_CONFIG, SandboxManager } from '../manager';

const testConfig: SandboxConfig = {
  ...DEFAULT_SANDBOX_CONFIG,
  maxExecutionTimeS: 5,
};

describe('SandboxManager', () => {
  let manager: SandboxManager;

  afterEach(async () => {
    if (manager) {
      await manager.destroyAll();
      manager.shutdown();
    }
  });

  test('initialize detects provider', async () => {
    manager = new SandboxManager();
    await manager.initialize();
    const name = manager.getProviderName();
    expect(['bubblewrap', 'direct']).toContain(name);
  });

  test('getOrCreate creates sandbox', async () => {
    manager = new SandboxManager();
    await manager.initialize();

    const sandbox = await manager.getOrCreate('ch-1', 'th-1', testConfig);
    expect(sandbox.id).toContain('ch-1');
    expect(manager.activeCount).toBe(1);
  });

  test('getOrCreate returns same sandbox for same thread', async () => {
    manager = new SandboxManager();
    await manager.initialize();

    const sb1 = await manager.getOrCreate('ch-1', 'th-1', testConfig);
    const sb2 = await manager.getOrCreate('ch-1', 'th-1', testConfig);
    expect(sb1.id).toBe(sb2.id);
    expect(manager.activeCount).toBe(1);
  });

  test('getOrCreate creates separate sandboxes for different threads', async () => {
    manager = new SandboxManager();
    await manager.initialize();

    const sb1 = await manager.getOrCreate('ch-1', 'th-1', testConfig);
    const sb2 = await manager.getOrCreate('ch-1', 'th-2', testConfig);
    expect(sb1.id).not.toBe(sb2.id);
    expect(manager.activeCount).toBe(2);
  });

  test('destroy removes sandbox', async () => {
    manager = new SandboxManager();
    await manager.initialize();

    await manager.getOrCreate('ch-1', 'th-1', testConfig);
    expect(manager.activeCount).toBe(1);

    await manager.destroy('ch-1', 'th-1');
    expect(manager.activeCount).toBe(0);
  });

  test('destroyAll cleans up all sandboxes', async () => {
    manager = new SandboxManager();
    await manager.initialize();

    await manager.getOrCreate('ch-1', 'th-1', testConfig);
    await manager.getOrCreate('ch-1', 'th-2', testConfig);
    await manager.getOrCreate('ch-2', 'th-3', testConfig);
    expect(manager.activeCount).toBe(3);

    await manager.destroyAll();
    expect(manager.activeCount).toBe(0);
  });

  test('throws if not initialized', async () => {
    manager = new SandboxManager();
    expect(manager.getOrCreate('ch-1', 'th-1', testConfig)).rejects.toThrow('not initialized');
  });
});
