import { getLogger } from '@logtape/logtape';
import { type ImageAttachment, VALKEY_KEYS, VALKEY_TTL } from '@personalclaw/shared';
import type { ChannelAdapter } from '../channels/adapter';
import { HooksEngine } from '../hooks/engine';
import { getRedis, isRedisAvailable } from '../redis';
import { errorDetails } from '../utils/error-fmt';
import { CostTracker } from './cost-tracker';
import { AgentEngine } from './engine';

const logger = getLogger(['personalclaw', 'agent', 'orchestrator']);

export interface OrchestratorParams {
  channelId: string;
  threadId: string;
  userId: string;
  text: string;
  images?: ImageAttachment[];
  adapter: ChannelAdapter;
}

export interface OrchestratorResult {
  text: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export class MessageOrchestrator {
  private engine: AgentEngine;
  private costTracker: CostTracker;
  private hooks: HooksEngine;
  private static enginePromise: Promise<AgentEngine> | null = null;

  constructor(engine?: AgentEngine, costTracker?: CostTracker, hooks?: HooksEngine) {
    this.engine = engine ?? (null as unknown as AgentEngine);
    this.costTracker = costTracker ?? new CostTracker();
    this.hooks = hooks ?? HooksEngine.getInstance();
  }

  private async getEngine(): Promise<AgentEngine> {
    if (this.engine) return this.engine;
    if (!MessageOrchestrator.enginePromise) {
      MessageOrchestrator.enginePromise = AgentEngine.create();
    }
    this.engine = await MessageOrchestrator.enginePromise;
    return this.engine;
  }

  async checkBudget(channelId: string) {
    return this.costTracker.isBudgetExceeded(channelId);
  }

  async process(params: OrchestratorParams): Promise<OrchestratorResult> {
    await this.hooks.emit('message:received', {
      channelId: params.channelId,
      externalUserId: params.userId,
      threadId: params.threadId,
      eventType: 'message:received',
      payload: { text: params.text },
    });

    const engine = await this.getEngine();
    const result = await engine.run({
      channelId: params.channelId,
      threadId: params.threadId,
      userId: params.userId,
      text: params.text,
      images: params.images,
      adapter: params.adapter,
    });

    logger.debug('Engine run completed', {
      channelId: params.channelId,
      threadId: params.threadId,
      provider: result.provider,
      model: result.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      durationMs: result.durationMs,
      responseLength: result.text.length,
    });

    await this.costTracker.log({
      channelId: params.channelId,
      externalUserId: params.userId,
      externalThreadId: params.threadId,
      provider: result.provider,
      model: result.model,
      promptTokens: result.usage.inputTokens,
      completionTokens: result.usage.outputTokens,
      durationMs: result.durationMs,
    });

    await this.storeFeedbackMetadata(params, result);

    await this.hooks.emit('message:sending', {
      channelId: params.channelId,
      externalUserId: params.userId,
      threadId: params.threadId,
      eventType: 'message:sending',
      payload: { response: result.text },
    });

    await params.adapter.sendMessage(params.threadId, result.text);

    await this.hooks.emit('message:sent', {
      channelId: params.channelId,
      externalUserId: params.userId,
      threadId: params.threadId,
      eventType: 'message:sent',
      payload: { response: result.text },
    });

    return {
      text: result.text,
      provider: result.provider,
      model: result.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      durationMs: result.durationMs,
    };
  }

  private async storeFeedbackMetadata(
    params: OrchestratorParams,
    result: { toolSequence: string[]; skillIds: string[] },
  ): Promise<void> {
    if (!isRedisAvailable() || result.toolSequence.length === 0) return;

    try {
      const feedbackKey = VALKEY_KEYS.feedbackMeta(params.channelId, params.threadId);
      await getRedis().set(
        feedbackKey,
        JSON.stringify({
          toolSequence: result.toolSequence,
          skillIds: result.skillIds,
          userId: params.userId,
        }),
        'EX',
        VALKEY_TTL.feedbackMeta,
      );
    } catch (error) {
      logger.warn('Failed to store feedback metadata', { ...errorDetails(error) });
    }
  }
}
