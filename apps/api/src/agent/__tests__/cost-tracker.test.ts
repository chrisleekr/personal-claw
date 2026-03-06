import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const mockDbInsert = mock(() => ({ values: mock(() => Promise.resolve()) }));
const mockDbSelect = mock(() => ({
  from: mock(() => ({
    where: mock(() => Promise.resolve([{ total: '0.50' }])),
  })),
}));

const mockGetDb = mock(() => ({
  insert: mockDbInsert,
  select: mockDbSelect,
}));

mock.module('../../db', () => ({
  getDb: mockGetDb,
}));

let mockRedisAvailable = false;
const mockRedisSet = mock(() => Promise.resolve('OK'));
const mockRedisGet = mock(() => Promise.resolve(null));

mock.module('../../redis', () => ({
  isRedisAvailable: () => mockRedisAvailable,
  getRedis: () => ({
    set: mockRedisSet,
    get: mockRedisGet,
  }),
}));

const mockHooksEmit = mock(() => Promise.resolve());

mock.module('../../hooks/engine', () => ({
  HooksEngine: {
    getInstance: () => ({
      emit: mockHooksEmit,
    }),
  },
}));

import { type CostLogEntry, CostTracker } from '../cost-tracker';

const baseEntry: CostLogEntry = {
  channelId: 'ch-001',
  externalUserId: 'user-1',
  externalThreadId: 'thread-1',
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  promptTokens: 1000,
  completionTokens: 500,
  durationMs: 2000,
};

describe('CostTracker', () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker();
    mockRedisAvailable = false;
    mockDbInsert.mockClear();
    mockDbSelect.mockClear();
    mockRedisSet.mockClear();
    mockRedisGet.mockClear();
    mockHooksEmit.mockClear();
  });

  afterEach(() => {
    mockRedisAvailable = false;
  });

  describe('calculateCost', () => {
    test('delegates to pricing module for known model', () => {
      const cost = tracker.calculateCost('claude-sonnet-4-20250514', 1_000_000, 0);
      expect(cost).toBe(3);
    });

    test('returns 0 for unknown model', () => {
      expect(tracker.calculateCost('nonexistent-model', 1000, 1000)).toBe(0);
    });

    test('returns 0 for zero tokens', () => {
      expect(tracker.calculateCost('claude-sonnet-4-20250514', 0, 0)).toBe(0);
    });
  });

  describe('log', () => {
    test('inserts usage log into database', async () => {
      const valuesFn = mock(() => Promise.resolve());
      mockDbInsert.mockReturnValue({ values: valuesFn });

      mockDbSelect.mockReturnValue({
        from: mock(() => ({
          where: mock(() => Promise.resolve([{ costBudgetDailyUsd: null }])),
        })),
      });

      await tracker.log(baseEntry);

      expect(mockDbInsert).toHaveBeenCalled();
      expect(valuesFn).toHaveBeenCalled();
    });

    test('does not throw on DB insert failure', async () => {
      mockDbInsert.mockReturnValue({
        values: mock(() => Promise.reject(new Error('DB error'))),
      });

      await expect(tracker.log(baseEntry)).resolves.toBeUndefined();
    });
  });

  describe('getTodaySpend', () => {
    test('returns parsed numeric total', async () => {
      mockDbSelect.mockReturnValue({
        from: mock(() => ({
          where: mock(() => Promise.resolve([{ total: '1.234' }])),
        })),
      });

      const spend = await tracker.getTodaySpend('ch-001');
      expect(spend).toBe(1.234);
    });

    test('returns 0 when no results', async () => {
      mockDbSelect.mockReturnValue({
        from: mock(() => ({
          where: mock(() => Promise.resolve([{ total: null }])),
        })),
      });

      const spend = await tracker.getTodaySpend('ch-001');
      expect(spend).toBe(0);
    });

    test('returns 0 when result array is empty', async () => {
      mockDbSelect.mockReturnValue({
        from: mock(() => ({
          where: mock(() => Promise.resolve([])),
        })),
      });

      const spend = await tracker.getTodaySpend('ch-001');
      expect(spend).toBe(0);
    });
  });

  describe('isBudgetExceeded', () => {
    test('returns exceeded false when no budget set', async () => {
      mockDbSelect.mockReturnValue({
        from: mock(() => ({
          where: mock(() => Promise.resolve([{ costBudgetDailyUsd: null }])),
        })),
      });

      const result = await tracker.isBudgetExceeded('ch-001');
      expect(result.exceeded).toBe(false);
      expect(result.budget).toBeNull();
    });

    test('returns exceeded false when budget is 0', async () => {
      mockDbSelect.mockReturnValue({
        from: mock(() => ({
          where: mock(() => Promise.resolve([{ costBudgetDailyUsd: '0' }])),
        })),
      });

      const result = await tracker.isBudgetExceeded('ch-001');
      expect(result.exceeded).toBe(false);
    });

    test('returns exceeded true when spend >= budget', async () => {
      let callCount = 0;
      mockDbSelect.mockImplementation(() => ({
        from: mock(() => ({
          where: mock(() => {
            callCount++;
            if (callCount === 1) {
              return Promise.resolve([{ costBudgetDailyUsd: '5.00' }]);
            }
            return Promise.resolve([{ total: '6.00' }]);
          }),
        })),
      }));

      const result = await tracker.isBudgetExceeded('ch-001');
      expect(result.exceeded).toBe(true);
      expect(result.todaySpend).toBe(6);
      expect(result.budget).toBe(5);
    });

    test('returns exceeded false when spend < budget', async () => {
      let callCount = 0;
      mockDbSelect.mockImplementation(() => ({
        from: mock(() => ({
          where: mock(() => {
            callCount++;
            if (callCount === 1) {
              return Promise.resolve([{ costBudgetDailyUsd: '10.00' }]);
            }
            return Promise.resolve([{ total: '3.00' }]);
          }),
        })),
      }));

      const result = await tracker.isBudgetExceeded('ch-001');
      expect(result.exceeded).toBe(false);
      expect(result.todaySpend).toBe(3);
      expect(result.budget).toBe(10);
    });

    test('returns safe defaults on error', async () => {
      mockDbSelect.mockReturnValue({
        from: mock(() => ({
          where: mock(() => Promise.reject(new Error('DB error'))),
        })),
      });

      const result = await tracker.isBudgetExceeded('ch-001');
      expect(result.exceeded).toBe(false);
      expect(result.todaySpend).toBe(0);
      expect(result.budget).toBeNull();
    });
  });
});
