import { channels, desc, eq, sql, sum, usageLogs } from '@personalclaw/db';
import { CostTracker } from '../agent/cost-tracker';
import { getDb } from '../db';

export class UsageService {
  private costTracker = new CostTracker();

  async getUsage(channelId: string) {
    const db = getDb();

    const rows = await db
      .select()
      .from(usageLogs)
      .where(eq(usageLogs.channelId, channelId))
      .orderBy(desc(usageLogs.createdAt))
      .limit(100);

    const [totals] = await db
      .select({
        totalTokens: sum(usageLogs.totalTokens),
        totalCost: sum(usageLogs.estimatedCostUsd),
      })
      .from(usageLogs)
      .where(eq(usageLogs.channelId, channelId));

    return {
      usage: rows,
      totalTokens: Number(totals?.totalTokens ?? 0),
      totalCost: Number(totals?.totalCost ?? 0),
    };
  }

  async getBudget(channelId: string) {
    const db = getDb();

    const [channel] = await db
      .select({ costBudgetDailyUsd: channels.costBudgetDailyUsd })
      .from(channels)
      .where(eq(channels.id, channelId));

    const budget = channel?.costBudgetDailyUsd ? Number(channel.costBudgetDailyUsd) : null;
    const todaySpend = await this.costTracker.getTodaySpend(channelId);
    const percentUsed = budget && budget > 0 ? (todaySpend / budget) * 100 : null;

    return { dailyBudget: budget, todaySpend, percentUsed };
  }

  async getDailyAggregates(channelId: string) {
    const db = getDb();

    const daily = await db
      .select({
        date: sql<string>`date_trunc('day', ${usageLogs.createdAt})::date`.as('date'),
        totalTokens: sum(usageLogs.totalTokens),
        totalCost: sum(usageLogs.estimatedCostUsd),
        requestCount: sql<number>`count(*)::int`.as('request_count'),
      })
      .from(usageLogs)
      .where(eq(usageLogs.channelId, channelId))
      .groupBy(sql`date_trunc('day', ${usageLogs.createdAt})::date`)
      .orderBy(sql`date_trunc('day', ${usageLogs.createdAt})::date`);

    return daily.map((d) => ({
      date: d.date,
      totalTokens: Number(d.totalTokens ?? 0),
      totalCost: Number(d.totalCost ?? 0),
      requestCount: d.requestCount,
    }));
  }
}
