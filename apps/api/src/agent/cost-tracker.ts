import { getLogger } from '@logtape/logtape';
import { channels, eq, sql, sum, usageLogs } from '@personalclaw/db';
import {
  BUDGET_ALERT_EXCEEDED_THRESHOLD,
  BUDGET_ALERT_WARNING_THRESHOLD,
  VALKEY_KEYS,
} from '@personalclaw/shared';
import { getDb } from '../db';
import { HooksEngine } from '../hooks/engine';
import { getRedis, isRedisAvailable } from '../redis';
import { errorDetails } from '../utils/error-fmt';
import { calculateCost } from './pricing';

const logger = getLogger(['personalclaw', 'agent', 'cost']);

export interface CostLogEntry {
  channelId: string;
  externalUserId: string;
  externalThreadId: string | null;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}

export class CostTracker {
  calculateCost(model: string, promptTokens: number, completionTokens: number): number {
    return calculateCost(model, promptTokens, completionTokens);
  }

  async log(entry: CostLogEntry): Promise<void> {
    const cost = this.calculateCost(entry.model, entry.promptTokens, entry.completionTokens);
    const totalTokens = entry.promptTokens + entry.completionTokens;

    try {
      const db = getDb();
      await db.insert(usageLogs).values({
        channelId: entry.channelId,
        externalUserId: entry.externalUserId,
        externalThreadId: entry.externalThreadId,
        provider: entry.provider,
        model: entry.model,
        promptTokens: entry.promptTokens,
        completionTokens: entry.completionTokens,
        totalTokens,
        estimatedCostUsd: cost.toFixed(6),
        durationMs: entry.durationMs,
      });

      await this.checkBudget(entry.channelId, entry.externalUserId);
    } catch (error) {
      logger.error('Failed to persist usage log', {
        channelId: entry.channelId,
        userId: entry.externalUserId,
        model: entry.model,
        ...errorDetails(error),
      });
      logger.info('Fallback cost log', {
        channelId: entry.channelId,
        userId: entry.externalUserId,
        model: entry.model,
        tokens: totalTokens,
        cost: cost.toFixed(6),
        durationMs: entry.durationMs,
      });
    }
  }

  async getTodaySpend(channelId: string): Promise<number> {
    const db = getDb();
    const [result] = await db
      .select({ total: sum(usageLogs.estimatedCostUsd) })
      .from(usageLogs)
      .where(
        sql`${usageLogs.channelId} = ${channelId} AND ${usageLogs.createdAt} >= date_trunc('day', now())`,
      );
    return Number(result?.total ?? 0);
  }

  async isBudgetExceeded(
    channelId: string,
  ): Promise<{ exceeded: boolean; todaySpend: number; budget: number | null }> {
    try {
      const db = getDb();
      const [channel] = await db
        .select({ costBudgetDailyUsd: channels.costBudgetDailyUsd })
        .from(channels)
        .where(eq(channels.id, channelId));

      const budget = channel?.costBudgetDailyUsd ? Number(channel.costBudgetDailyUsd) : null;
      if (!budget || budget <= 0) {
        return { exceeded: false, todaySpend: 0, budget };
      }

      const todaySpend = await this.getTodaySpend(channelId);
      return {
        exceeded: todaySpend >= budget,
        todaySpend,
        budget,
      };
    } catch (error) {
      logger.warn('Failed to check budget pre-execution', { channelId, ...errorDetails(error) });
      return { exceeded: false, todaySpend: 0, budget: null };
    }
  }

  private async checkBudget(channelId: string, externalUserId: string): Promise<void> {
    try {
      const db = getDb();
      const [channel] = await db
        .select({ costBudgetDailyUsd: channels.costBudgetDailyUsd })
        .from(channels)
        .where(eq(channels.id, channelId));

      if (!channel?.costBudgetDailyUsd) return;
      const budget = Number(channel.costBudgetDailyUsd);
      if (budget <= 0) return;

      const todaySpend = await this.getTodaySpend(channelId);
      const ratio = todaySpend / budget;

      const today = new Date().toISOString().slice(0, 10);

      if (ratio >= BUDGET_ALERT_EXCEEDED_THRESHOLD) {
        await this.emitBudgetAlert(
          channelId,
          externalUserId,
          'exceeded',
          todaySpend,
          budget,
          today,
        );
      } else if (ratio >= BUDGET_ALERT_WARNING_THRESHOLD) {
        await this.emitBudgetAlert(channelId, externalUserId, 'warning', todaySpend, budget, today);
      }
    } catch (error) {
      logger.warn('Failed to check budget', { channelId, ...errorDetails(error) });
    }
  }

  private async emitBudgetAlert(
    channelId: string,
    externalUserId: string,
    level: 'warning' | 'exceeded',
    todaySpend: number,
    budget: number,
    today: string,
  ): Promise<void> {
    const dedupKey = VALKEY_KEYS.budgetAlert(channelId, today, level);

    if (isRedisAvailable()) {
      const redis = getRedis();
      const alreadySent = await redis.set(dedupKey, '1', 'EX', 86400, 'NX');
      if (!alreadySent) return;
    }

    const eventType = level === 'exceeded' ? 'budget:exceeded' : 'budget:warning';
    const hooks = HooksEngine.getInstance();
    await hooks.emit(eventType, {
      channelId,
      externalUserId,
      threadId: '',
      eventType,
      payload: {
        todaySpend: todaySpend.toFixed(4),
        budget: budget.toFixed(2),
        percentUsed: ((todaySpend / budget) * 100).toFixed(1),
        level,
      },
    });

    logger.info('Budget alert emitted', { channelId, level, todaySpend, budget });
  }
}
