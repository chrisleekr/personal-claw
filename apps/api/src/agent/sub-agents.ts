import { getLogger } from '@logtape/logtape';
import { VALKEY_KEYS, VALKEY_TTL } from '@personalclaw/shared';
import { generateText, stepCountIs, type ToolSet } from 'ai';
import { nanoid } from 'nanoid';
import { getRedis, isRedisAvailable } from '../redis';
import { errorDetails } from '../utils/error-fmt';
import { getProvider } from './provider';

const logger = getLogger(['personalclaw', 'agent', 'sub-agents']);

interface SubtaskParams {
  channelId: string;
  instruction: string;
  model?: string;
  tools?: ToolSet;
  timeoutMs?: number;
}

export interface SubtaskResult {
  taskId: string;
  text: string;
  status: 'completed' | 'failed' | 'timeout';
  durationMs: number;
}

async function storeResult(taskId: string, result: SubtaskResult): Promise<void> {
  if (isRedisAvailable()) {
    try {
      const redis = getRedis();
      await redis.set(
        VALKEY_KEYS.subtaskResult(taskId),
        JSON.stringify(result),
        'EX',
        VALKEY_TTL.subtaskResult,
      );
      return;
    } catch (error) {
      logger.warn('Failed to store subtask result in Valkey, using in-memory fallback', {
        taskId,
        ...errorDetails(error),
      });
    }
  }
  fallbackResults.set(taskId, result);
}

async function loadResult(taskId: string): Promise<SubtaskResult | null> {
  if (isRedisAvailable()) {
    try {
      const redis = getRedis();
      const raw = await redis.get(VALKEY_KEYS.subtaskResult(taskId));
      if (raw) return JSON.parse(raw) as SubtaskResult;
    } catch (error) {
      logger.warn('Failed to load subtask result from Valkey', { taskId, ...errorDetails(error) });
    }
  }
  return fallbackResults.get(taskId) ?? null;
}

const fallbackResults = new Map<string, SubtaskResult>();

export async function spawnSubtask(params: SubtaskParams): Promise<string> {
  const taskId = nanoid();
  const start = Date.now();

  const run = async () => {
    try {
      const { provider, model } = await getProvider(params.channelId);
      const result = await generateText({
        model: provider(params.model || model),
        prompt: params.instruction,
        tools: params.tools || {},
        stopWhen: stepCountIs(5),
      });

      await storeResult(taskId, {
        taskId,
        text: result.text || '',
        status: 'completed',
        durationMs: Date.now() - start,
      });
    } catch (error) {
      await storeResult(taskId, {
        taskId,
        text: (error as Error).message,
        status: 'failed',
        durationMs: Date.now() - start,
      });
    }
  };

  const timeoutMs = params.timeoutMs || 30000;
  Promise.race([
    run(),
    new Promise<void>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
  ]).catch(async () => {
    await storeResult(taskId, {
      taskId,
      text: 'Subtask timed out',
      status: 'timeout',
      durationMs: Date.now() - start,
    });
  });

  return taskId;
}

export async function getSubtaskResult(taskId: string): Promise<SubtaskResult | null> {
  return loadResult(taskId);
}
