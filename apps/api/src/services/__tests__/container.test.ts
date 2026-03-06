import { describe, expect, mock, test } from 'bun:test';

mock.module('../../db', () => ({
  getDb: () => ({}),
}));

mock.module('../../redis', () => ({
  isRedisAvailable: () => false,
  getRedis: () => null,
}));

mock.module('../../config/hot-reload', () => ({
  emitConfigChange: () => {},
}));

mock.module('../../channels/config-cache', () => ({
  invalidateConfig: () => {},
  getCachedConfig: async () => null,
}));

mock.module('../../agent/cost-tracker', () => ({
  CostTracker: class {
    async getTodaySpend() {
      return 0;
    }
  },
}));

import { services } from '../container';

describe('ServiceContainer', () => {
  test('exposes channels service', () => {
    expect(services.channels).toBeDefined();
    expect(typeof services.channels.list).toBe('function');
  });

  test('exposes skills service', () => {
    expect(services.skills).toBeDefined();
  });

  test('exposes schedules service', () => {
    expect(services.schedules).toBeDefined();
  });

  test('exposes mcp service', () => {
    expect(services.mcp).toBeDefined();
  });

  test('exposes identity service', () => {
    expect(services.identity).toBeDefined();
  });

  test('exposes usage service', () => {
    expect(services.usage).toBeDefined();
  });

  test('exposes memories service', () => {
    expect(services.memories).toBeDefined();
  });

  test('exposes approvals service', () => {
    expect(services.approvals).toBeDefined();
  });

  test('exposes conversations service', () => {
    expect(services.conversations).toBeDefined();
  });

  test('exposes sandbox service', () => {
    expect(services.sandbox).toBeDefined();
  });

  test('returns same instance on repeated access (singleton)', () => {
    const first = services.channels;
    const second = services.channels;
    expect(first).toBe(second);
  });

  test('returns different instances for different services', () => {
    const channels = services.channels;
    const skills = services.skills;
    expect(channels).not.toBe(skills);
  });
});
