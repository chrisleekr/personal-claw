import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';

const MOCK_USAGE_ROW = {
  id: 'usage-001',
  channelId: CHANNEL_ID,
  model: 'claude-sonnet-4-20250514',
  promptTokens: 100,
  completionTokens: 200,
  totalTokens: 300,
  estimatedCostUsd: '0.003300',
  createdAt: new Date(),
};

let mockSelectRows: unknown[] = [];
let mockTotalsRows: unknown[] = [];
let mockChannelRows: unknown[] = [];
let mockDailyRows: unknown[] = [];
let mockTodaySpend = 0;
let selectCallCount = 0;

mock.module('../../db', () => ({
  getDb: () => ({
    select: () => {
      selectCallCount++;
      const callNum = selectCallCount;
      return {
        from: () => ({
          where: () => {
            const result = {
              orderBy: () => ({
                limit: () => [...mockSelectRows],
              }),
              groupBy: () => ({
                orderBy: () => [...mockDailyRows],
              }),
            };
            if (callNum % 2 === 0) {
              return [...mockTotalsRows];
            }
            return result;
          },
        }),
      };
    },
  }),
}));

mock.module('../../agent/cost-tracker', () => ({
  CostTracker: class MockCostTracker {
    async getTodaySpend() {
      return mockTodaySpend;
    }
  },
}));

import { UsageService } from '../usage.service';

describe('UsageService', () => {
  let service: UsageService;

  beforeEach(() => {
    service = new UsageService();
    mockSelectRows = [];
    mockTotalsRows = [];
    mockChannelRows = [];
    mockDailyRows = [];
    mockTodaySpend = 0;
    selectCallCount = 0;
  });

  afterEach(() => {
    mockSelectRows = [];
    mockTotalsRows = [];
    mockChannelRows = [];
    mockDailyRows = [];
    mockTodaySpend = 0;
    selectCallCount = 0;
  });

  describe('getUsage', () => {
    test('returns usage rows and totals', async () => {
      mockSelectRows = [MOCK_USAGE_ROW];
      mockTotalsRows = [{ totalTokens: '300', totalCost: '0.003300' }];
      const result = await service.getUsage(CHANNEL_ID);
      expect(result.usage).toHaveLength(1);
      expect(result.totalTokens).toBe(300);
      expect(result.totalCost).toBeCloseTo(0.0033);
    });

    test('returns zero totals when no usage', async () => {
      mockSelectRows = [];
      mockTotalsRows = [{ totalTokens: null, totalCost: null }];
      const result = await service.getUsage(CHANNEL_ID);
      expect(result.usage).toHaveLength(0);
      expect(result.totalTokens).toBe(0);
      expect(result.totalCost).toBe(0);
    });
  });

  describe('getBudget', () => {
    test('returns budget with spend and percent', async () => {
      mockChannelRows = [{ costBudgetDailyUsd: '10.00' }];
      mockTodaySpend = 3.5;
      selectCallCount = 0;
      mock.module('../../db', () => ({
        getDb: () => ({
          select: () => ({
            from: () => ({
              where: () => [...mockChannelRows],
            }),
          }),
        }),
      }));
      const svc = new UsageService();
      const result = await svc.getBudget(CHANNEL_ID);
      expect(result.dailyBudget).toBe(10);
      expect(result.todaySpend).toBe(3.5);
      expect(result.percentUsed).toBeCloseTo(35);
    });

    test('returns null budget when channel has no budget', async () => {
      mockChannelRows = [{ costBudgetDailyUsd: null }];
      mock.module('../../db', () => ({
        getDb: () => ({
          select: () => ({
            from: () => ({
              where: () => [...mockChannelRows],
            }),
          }),
        }),
      }));
      const svc = new UsageService();
      const result = await svc.getBudget(CHANNEL_ID);
      expect(result.dailyBudget).toBeNull();
      expect(result.percentUsed).toBeNull();
    });
  });

  describe('getDailyAggregates', () => {
    test('returns daily aggregates mapped correctly', async () => {
      mockDailyRows = [
        { date: '2026-03-01', totalTokens: '500', totalCost: '0.01', requestCount: 3 },
      ];
      mock.module('../../db', () => ({
        getDb: () => ({
          select: () => ({
            from: () => ({
              where: () => ({
                groupBy: () => ({
                  orderBy: () => [...mockDailyRows],
                }),
              }),
            }),
          }),
        }),
      }));
      const svc = new UsageService();
      const result = await svc.getDailyAggregates(CHANNEL_ID);
      expect(result).toHaveLength(1);
      expect(result[0].totalTokens).toBe(500);
      expect(result[0].totalCost).toBeCloseTo(0.01);
      expect(result[0].requestCount).toBe(3);
    });

    test('returns empty array when no data', async () => {
      mockDailyRows = [];
      mock.module('../../db', () => ({
        getDb: () => ({
          select: () => ({
            from: () => ({
              where: () => ({
                groupBy: () => ({
                  orderBy: () => [...mockDailyRows],
                }),
              }),
            }),
          }),
        }),
      }));
      const svc = new UsageService();
      const result = await svc.getDailyAggregates(CHANNEL_ID);
      expect(result).toHaveLength(0);
    });
  });
});
