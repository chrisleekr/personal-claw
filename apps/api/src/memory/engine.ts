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
  private static CACHE_TTL_MS = 60_000;

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
      await this.triggerCompaction(channelId, threadId, updatedHistory);
    }
  }

  async triggerCompaction(
    channelId: string,
    threadId: string,
    messages?: ConversationMessage[],
  ): Promise<void> {
    const history = messages ?? (await this.conversation.getHistory(channelId, threadId));
    if (history.length === 0) return;

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
    await this.conversation.compact(channelId, threadId, summary);
    await this.working.delete(channelId, threadId);

    logger.info`Compaction complete for channel=${channelId} thread=${threadId}`;
  }
}
