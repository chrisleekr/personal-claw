import { getLogger } from '@logtape/logtape';
import { channels, eq } from '@personalclaw/db';
import {
  type ChannelMemory,
  type ConversationMessage,
  DEFAULT_MEMORY_CONFIG,
  type MemoryConfig,
  memoryConfigSchema,
} from '@personalclaw/shared';
import { buildCompactionPrompt, shouldCompact } from '../agent/compaction';
import { writeAuditEvent } from '../agent/detection/audit';
import type { DetectionEngine } from '../agent/detection/engine';
import { getDb } from '../db';
import { errorDetails } from '../utils/error-fmt';
import { ConversationMemory } from './conversation';
import { LongTermMemory } from './longterm';
import { WorkingMemory } from './working';

const logger = getLogger(['personalclaw', 'memory', 'engine']);

export interface AssembledContext {
  messages: ConversationMessage[];
  memories: ChannelMemory[];
}

export class MemoryEngine {
  private working = new WorkingMemory();
  private conversation = new ConversationMemory();
  private longterm = new LongTermMemory();
  private configCache = new Map<string, { config: MemoryConfig; loadedAt: number }>();
  /**
   * Per-thread in-flight compaction promises. Keyed by `${channelId}:${threadId}`.
   * Used by `persistConversation` to prevent multiple background compactions
   * from racing for the same thread — the second trigger is a no-op while
   * the first is still running. Without this guard, a slow LLM summarisation
   * stacked behind a fast user follow-up could produce two parallel
   * `compact()` calls, the later one wiping messages appended after the
   * earlier snapshot was captured.
   */
  private compactionsInFlight = new Map<string, Promise<void>>();
  private static CACHE_TTL_MS = 60_000;
  /**
   * Optional detection engine for FR-025 recall-time memory detection.
   * Injected by the agent engine after MemoryEngine construction so the
   * MemoryEngine can be constructed before GuardrailsEngine (breaks a
   * circular dependency). If absent, recall-time detection is skipped.
   */
  private detectionEngine: DetectionEngine | null = null;

  /**
   * Injects the detection engine for recall-time memory filtering (FR-025).
   * Called once at agent engine construction time.
   */
  setDetectionEngine(engine: DetectionEngine): void {
    this.detectionEngine = engine;
  }

  private async getMemoryConfig(channelId: string): Promise<MemoryConfig> {
    const cached = this.configCache.get(channelId);
    if (cached && Date.now() - cached.loadedAt < MemoryEngine.CACHE_TTL_MS) {
      return cached.config;
    }

    try {
      const db = getDb();
      const [row] = await db
        .select({ memoryConfig: channels.memoryConfig })
        .from(channels)
        .where(eq(channels.id, channelId));

      if (!row?.memoryConfig) {
        this.configCache.set(channelId, { config: DEFAULT_MEMORY_CONFIG, loadedAt: Date.now() });
        return DEFAULT_MEMORY_CONFIG;
      }

      const parsed = memoryConfigSchema.safeParse(row.memoryConfig);
      const config = parsed.success ? (parsed.data as MemoryConfig) : DEFAULT_MEMORY_CONFIG;

      if (!parsed.success) {
        logger.warn('Invalid memory config, using defaults', {
          channelId,
          errors: parsed.error.issues,
        });
      }

      this.configCache.set(channelId, { config, loadedAt: Date.now() });
      return config;
    } catch (error) {
      logger.warn('Failed to load memory config, using defaults', {
        channelId,
        ...errorDetails(error),
      });
      return DEFAULT_MEMORY_CONFIG;
    }
  }

  async assembleContext(channelId: string, threadId: string): Promise<AssembledContext> {
    const memoryConfig = await this.getMemoryConfig(channelId);
    const workingState = await this.working.get(channelId, threadId);

    let conversationMessages: ConversationMessage[];
    if (workingState?.messages && workingState.messages.length > 0) {
      conversationMessages = workingState.messages;
    } else {
      conversationMessages = await this.conversation.getHistory(channelId, threadId);
    }

    const lastUserMessage = conversationMessages.filter((m) => m.role === 'user').pop();
    const searchQuery = lastUserMessage?.content ?? '';

    let memories: ChannelMemory[] = [];
    if (searchQuery) {
      memories = await this.longterm.search(channelId, searchQuery, memoryConfig.injectTopN);
      if (memories.length > 0) {
        const memoryIds = memories.map((m) => m.id);
        await this.longterm.incrementRecall(memoryIds);
      }
    }

    // FR-025 recall-time detection: route every recalled memory through the
    // input-side detection pipeline BEFORE it can be added to the system
    // prompt. Poisoned memories are skipped and audit-logged; the turn
    // proceeds with the remaining clean memories.
    //
    // The engine is injected via setDetectionEngine(); if it is absent
    // (e.g. during unit tests that don't wire it) we skip filtering and
    // return all recalled memories. The guardrails pipeline's preProcess
    // layer is still the authoritative gate for user messages.
    const detection = this.detectionEngine;
    if (detection && memories.length > 0) {
      const filtered: ChannelMemory[] = [];
      // Parallel detect calls per research.md R4. Classifier is skipped at
      // engine level via short-circuit; the heuristics + similarity layers
      // run cheaply.
      const results = await Promise.all(
        memories.map(async (mem) => {
          try {
            return {
              memory: mem,
              result: await detection.detect(
                mem.content,
                {
                  channelId,
                  externalUserId: 'memory-recall',
                  threadId,
                  sourceKind: 'memory_recall',
                  recentHistory: [],
                },
                // Defaults are fine for memory recall; the caller cannot
                // pass config here without importing guardrails.ts which
                // would create a cycle.
                {
                  preProcessing: {
                    contentFiltering: true,
                    intentClassification: false,
                    maxInputLength: 50000,
                  },
                  postProcessing: { piiRedaction: false, outputValidation: true },
                  defenseProfile: 'balanced',
                  canaryTokenEnabled: false,
                  auditRetentionDays: 7,
                  detection: {
                    heuristicThreshold: 60,
                    similarityThreshold: 0.85,
                    similarityShortCircuitThreshold: 0.92,
                    classifierEnabled: false, // skip classifier per R4
                    classifierTimeoutMs: 3000,
                  },
                },
              ),
            };
          } catch (error) {
            logger.warn('Recall-time detection failed for memory; keeping it (fail-open)', {
              channelId,
              memoryId: mem.id,
              error: (error as Error).message,
            });
            return { memory: mem, result: null };
          }
        }),
      );

      for (const { memory, result } of results) {
        if (!result || result.decision.action !== 'block') {
          filtered.push(memory);
          continue;
        }
        logger.info('Recall-time detection skipped a poisoned memory', {
          channelId,
          memoryId: memory.id,
          referenceId: result.decision.referenceId,
          reasonCode: result.decision.reasonCode,
        });
        // Audit the skip so admins can see which memories were poisoned.
        try {
          await writeAuditEvent({
            decision: {
              ...result.decision,
              sourceKind: 'memory_recall',
            },
            layerResults: result.layerResults,
            channelId,
            externalUserId: 'memory-recall',
            threadId,
            rawExcerpt: memory.content,
            canaryHit: false,
          });
        } catch (error) {
          logger.error('Failed to audit recall-time detection block', {
            channelId,
            memoryId: memory.id,
            error: (error as Error).message,
          });
        }
      }
      memories = filtered;
    }

    return { messages: conversationMessages, memories };
  }

  async persistUserMessage(
    channelId: string,
    threadId: string,
    message: ConversationMessage,
  ): Promise<void> {
    await this.conversation.append(channelId, threadId, message);
    const updatedHistory = await this.conversation.getHistory(channelId, threadId);
    await this.working.set(channelId, threadId, {
      messages: updatedHistory,
      channelId,
      threadId,
      lastActivityAt: new Date().toISOString(),
    });
  }

  async persistConversation(
    channelId: string,
    threadId: string,
    userMessage: ConversationMessage,
    assistantMessage: ConversationMessage,
  ): Promise<void> {
    const { tokenCount } = await this.conversation.append(
      channelId,
      threadId,
      userMessage,
      assistantMessage,
    );

    const updatedHistory = await this.conversation.getHistory(channelId, threadId);
    await this.working.set(channelId, threadId, {
      messages: updatedHistory,
      channelId,
      threadId,
      lastActivityAt: new Date().toISOString(),
    });

    if (shouldCompact(tokenCount)) {
      // Fire-and-forget: compaction runs an LLM call that can take 5–30s and
      // can fail independently of the request that just succeeded. Awaiting
      // here would couple request latency and request success to background
      // summarization work.
      const key = `${channelId}:${threadId}`;
      if (this.compactionsInFlight.has(key)) {
        // A compaction is already running for this thread; if the running
        // one finishes cleanly the conversation is summarised. If newer
        // messages snuck in past its snapshot, its conditional UPDATE will
        // no-op and the next persistConversation will re-trigger. Either
        // way, stacking a second LLM call here would only burn quota.
        return;
      }

      const promise = this.triggerCompaction(channelId, threadId, updatedHistory)
        .catch((err) => {
          logger.error('Compaction failed', {
            channelId,
            threadId,
            ...errorDetails(err),
          });
        })
        .finally(() => {
          this.compactionsInFlight.delete(key);
        });
      this.compactionsInFlight.set(key, promise);
    }
  }

  async triggerCompaction(
    channelId: string,
    threadId: string,
    messages?: ConversationMessage[],
  ): Promise<void> {
    const history = messages ?? (await this.conversation.getHistory(channelId, threadId));
    if (history.length === 0) return;

    // Capture the snapshot length BEFORE the LLM call so the conditional
    // UPDATE in compact() can detect concurrent appends and abort. Without
    // this guard, a follow-up message persisted while the LLM is summarising
    // would be wiped by the unconditional `messages = '[]'::jsonb` UPDATE,
    // since that follow-up was not represented in the summary.
    const expectedMessageCount = history.length;

    const { generateText } = await import('ai');
    const { getProvider } = await import('../agent/provider');
    const { getMemoryTools } = await import('./tools');

    const { provider, model } = await getProvider(channelId);
    const memoryTools = getMemoryTools(channelId);
    const compactionPrompt = buildCompactionPrompt(history);

    const result = await generateText({
      model: provider(model),
      prompt: compactionPrompt,
      tools: memoryTools,
      stopWhen: (await import('ai')).stepCountIs(5),
    });

    const summary = result.text || 'Conversation compacted.';
    const compacted = await this.conversation.compact(
      channelId,
      threadId,
      summary,
      expectedMessageCount,
    );

    if (!compacted) {
      // Newer messages were appended while the LLM was summarising; the
      // conditional UPDATE rejected the write to avoid clobbering them.
      // Leave working memory intact (it still mirrors the persisted state)
      // so the next turn does not pay an unnecessary getHistory round-trip.
      logger.info`Compaction skipped — messages changed since snapshot for channel=${channelId} thread=${threadId}`;
      return;
    }

    await this.working.delete(channelId, threadId);

    logger.info`Compaction complete for channel=${channelId} thread=${threadId}`;
  }
}
