import { beforeEach, describe, expect, mock, test } from 'bun:test';

let mockDeletedRows: Array<{ id: string }> = [];

mock.module('../../db', () => ({
  getDb: () => ({
    delete: () => ({
      where: () => ({
        returning: () => mockDeletedRows,
      }),
    }),
  }),
}));

mock.module('../../utils/error-fmt', () => ({
  errorDetails: (err: unknown) => ({ message: String(err) }),
}));

const mockCronSchedule = mock((_expr: string, _cb: () => void) => {
  return { stop: mock(() => {}) };
});

mock.module('node-cron', () => ({
  default: {
    schedule: mockCronSchedule,
  },
}));

import { cleanupDecayedMemories, initMemoryDecay } from '../decay';

describe('cleanupDecayedMemories', () => {
  beforeEach(() => {
    mockDeletedRows = [];
  });

  test('returns 0 when no memories are decayed', async () => {
    mockDeletedRows = [];
    const count = await cleanupDecayedMemories();
    expect(count).toBe(0);
  });

  test('returns count of deleted memories', async () => {
    mockDeletedRows = [{ id: 'mem-1' }, { id: 'mem-2' }, { id: 'mem-3' }];
    const count = await cleanupDecayedMemories();
    expect(count).toBe(3);
  });

  test('returns correct count for single deletion', async () => {
    mockDeletedRows = [{ id: 'mem-solo' }];
    const count = await cleanupDecayedMemories();
    expect(count).toBe(1);
  });
});

describe('initMemoryDecay', () => {
  beforeEach(() => {
    mockCronSchedule.mockClear();
  });

  test('schedules daily cleanup at 03:00', () => {
    initMemoryDecay();
    expect(mockCronSchedule).toHaveBeenCalledTimes(1);
    expect(mockCronSchedule.mock.calls[0][0]).toBe('0 3 * * *');
  });

  test('scheduled callback invokes cleanupDecayedMemories', async () => {
    initMemoryDecay();
    const callback = mockCronSchedule.mock.calls[0][1] as () => Promise<void>;
    mockDeletedRows = [{ id: 'mem-x' }];
    await expect(callback()).resolves.toBeUndefined();
  });
});
