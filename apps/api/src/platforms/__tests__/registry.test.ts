import { afterEach, describe, expect, mock, test } from 'bun:test';

mock.module('@logtape/logtape', () => ({
  getLogger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

mock.module('../../utils/error-fmt', () => ({
  errorDetails: () => ({}),
}));

import { NoOpAdapter } from '../../channels/no-op-adapter';
import { PlatformRegistry } from '../registry';
import type { PlatformPlugin } from '../types';

function makePlugin(overrides: Partial<PlatformPlugin> = {}): PlatformPlugin {
  return {
    name: overrides.name ?? 'test-platform',
    init: overrides.init ?? (async () => {}),
    createAdapter: overrides.createAdapter ?? (() => new NoOpAdapter()),
    enrichChannelName: overrides.enrichChannelName,
    shutdown: overrides.shutdown,
  };
}

describe('PlatformRegistry', () => {
  afterEach(() => {
    for (const name of PlatformRegistry.list()) {
      (PlatformRegistry as unknown as { plugins: Map<string, PlatformPlugin> }).plugins.delete(
        name,
      );
    }
  });

  test('register and get return the plugin', () => {
    const plugin = makePlugin({ name: 'slack' });
    PlatformRegistry.register(plugin);
    expect(PlatformRegistry.get('slack')).toBe(plugin);
  });

  test('get returns undefined for unregistered platform', () => {
    expect(PlatformRegistry.get('nonexistent')).toBeUndefined();
  });

  test('list returns registered platform names', () => {
    PlatformRegistry.register(makePlugin({ name: 'alpha' }));
    PlatformRegistry.register(makePlugin({ name: 'beta' }));
    expect(PlatformRegistry.list().sort()).toEqual(['alpha', 'beta']);
  });

  test('register overwrites plugin with same name', () => {
    const first = makePlugin({ name: 'dup' });
    const second = makePlugin({ name: 'dup' });
    PlatformRegistry.register(first);
    PlatformRegistry.register(second);
    expect(PlatformRegistry.get('dup')).toBe(second);
    expect(PlatformRegistry.list()).toEqual(['dup']);
  });

  test('createAdapter delegates to the registered plugin', () => {
    const mockAdapter = new NoOpAdapter();
    const plugin = makePlugin({
      name: 'slack',
      createAdapter: () => mockAdapter,
    });
    PlatformRegistry.register(plugin);

    const adapter = PlatformRegistry.createAdapter({
      id: 'ch-1',
      platform: 'slack',
      externalId: 'C123',
    });
    expect(adapter).toBe(mockAdapter);
  });

  test('createAdapter returns NoOpAdapter for unknown platform', () => {
    const adapter = PlatformRegistry.createAdapter({
      id: 'ch-2',
      platform: 'unknown',
      externalId: 'X999',
    });
    expect(adapter).toBeInstanceOf(NoOpAdapter);
  });

  test('enrichChannelName delegates to plugin when available', async () => {
    const plugin = makePlugin({
      name: 'slack',
      enrichChannelName: async (_extId: string, _chId: string) => '#general',
    });
    PlatformRegistry.register(plugin);

    const result = await PlatformRegistry.enrichChannelName('slack', 'C123', 'ch-1');
    expect(result).toBe('#general');
  });

  test('enrichChannelName returns null when plugin has no enricher', async () => {
    PlatformRegistry.register(makePlugin({ name: 'basic' }));
    const result = await PlatformRegistry.enrichChannelName('basic', 'X1', 'ch-1');
    expect(result).toBeNull();
  });

  test('enrichChannelName returns null for unknown platform', async () => {
    const result = await PlatformRegistry.enrichChannelName('ghost', 'X1', 'ch-1');
    expect(result).toBeNull();
  });

  test('initAll calls init on all registered plugins', async () => {
    const initA = mock(async () => {});
    const initB = mock(async () => {});
    PlatformRegistry.register(makePlugin({ name: 'a', init: initA }));
    PlatformRegistry.register(makePlugin({ name: 'b', init: initB }));

    await PlatformRegistry.initAll();
    expect(initA).toHaveBeenCalledTimes(1);
    expect(initB).toHaveBeenCalledTimes(1);
  });

  test('initAll continues when one plugin throws', async () => {
    const initGood = mock(async () => {});
    PlatformRegistry.register(
      makePlugin({
        name: 'bad',
        init: async () => {
          throw new Error('init boom');
        },
      }),
    );
    PlatformRegistry.register(makePlugin({ name: 'good', init: initGood }));

    await PlatformRegistry.initAll();
    expect(initGood).toHaveBeenCalledTimes(1);
  });

  test('shutdownAll calls shutdown on plugins that define it', async () => {
    const shutdownFn = mock(async () => {});
    PlatformRegistry.register(makePlugin({ name: 'with-shutdown', shutdown: shutdownFn }));
    PlatformRegistry.register(makePlugin({ name: 'no-shutdown' }));

    await PlatformRegistry.shutdownAll();
    expect(shutdownFn).toHaveBeenCalledTimes(1);
  });

  test('shutdownAll continues when one plugin throws', async () => {
    const shutdownGood = mock(async () => {});
    PlatformRegistry.register(
      makePlugin({
        name: 'bad-shutdown',
        shutdown: async () => {
          throw new Error('shutdown boom');
        },
      }),
    );
    PlatformRegistry.register(makePlugin({ name: 'good-shutdown', shutdown: shutdownGood }));

    await PlatformRegistry.shutdownAll();
    expect(shutdownGood).toHaveBeenCalledTimes(1);
  });
});
