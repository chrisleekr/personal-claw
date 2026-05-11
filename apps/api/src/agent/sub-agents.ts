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
  const timeoutMs = params.timeoutMs ?? 30000;

  // Use AbortController so the timeout actually cancels the underlying
  // generateText call (it accepts abortSignal). Promise.race only races
  // resolution — the LLM call would continue in the background and burn
  // quota. The controller is the single source of truth for "timed out".
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const run = async () => {
    try {
      const { provider, model } = await getProvider(params.channelId);
      const result = await generateText({
        model: provider(params.model ?? model),
        prompt: params.instruction,
        tools: params.tools ?? {},
        stopWhen: stepCountIs(5),
        abortSignal: controller.signal,
      });

      // Stop the timer the moment generateText settles so the abort callback
      // can't fire during the subsequent storeResult await and flip the
      // recorded status to 'timeout' after we've already chosen 'completed'.
      clearTimeout(timer);

      // Re-check after clearTimeout in case the timer fired between
      // generateText resolving and us reaching this line. The abort verdict
      // is authoritative — if it fired within the budget, the caller has
      // already given up.
      if (timedOut || controller.signal.aborted) {
        await storeResult(taskId, {
          taskId,
          text: 'Subtask timed out',
          status: 'timeout',
          durationMs: Date.now() - start,
        });
        return;
      }

      await storeResult(taskId, {
        taskId,
        text: result.text || '',
        status: 'completed',
        durationMs: Date.now() - start,
      });
    } catch (error) {
      clearTimeout(timer);
      // generateText surfaces aborts as either AbortError or a thrown
      // controller.signal.reason. Map both to a timeout outcome rather than
      // a generic failure.
      const isAbort =
        timedOut ||
        controller.signal.aborted ||
        (error as Error).name === 'AbortError' ||
        (error as Error).message?.toLowerCase().includes('abort');

      await storeResult(taskId, {
        taskId,
        text: isAbort ? 'Subtask timed out' : (error as Error).message,
        status: isAbort ? 'timeout' : 'failed',
        durationMs: Date.now() - start,
      });
    }
  };

  void run();

  return taskId;
}

export async function getSubtaskResult(taskId: string): Promise<SubtaskResult | null> {
  return loadResult(taskId);
}
