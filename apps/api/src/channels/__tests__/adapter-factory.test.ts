import { describe, expect, mock, test } from 'bun:test';

const mockAdapter = {
  sendMessage: async () => {},
  requestApproval: async () => true,
  requestPlanApproval: async () => true,
};

mock.module('../../platforms/registry', () => ({
  PlatformRegistry: {
    createAdapter: () => mockAdapter,
  },
}));

import { createChannelAdapter } from '../adapter-factory';

describe('createChannelAdapter', () => {
  test('delegates to PlatformRegistry.createAdapter', () => {
    const channel = { id: 'ch-1', platform: 'slack', externalId: 'C123' };
    const adapter = createChannelAdapter(channel as never);
    expect(adapter).toBe(mockAdapter);
  });

  test('returned adapter has expected methods', () => {
    const channel = { id: 'ch-2', platform: 'slack', externalId: 'C456' };
    const adapter = createChannelAdapter(channel as never);
    expect(typeof adapter.sendMessage).toBe('function');
    expect(typeof adapter.requestApproval).toBe('function');
  });
});
