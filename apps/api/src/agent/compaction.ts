import type { ConversationMessage } from '@personalclaw/shared';
import { COMPACTION_TOKEN_THRESHOLD } from '@personalclaw/shared';

export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

export function shouldCompact(tokenCount: number): boolean {
  return tokenCount >= COMPACTION_TOKEN_THRESHOLD;
}

export function buildCompactionPrompt(messages: ConversationMessage[]): string {
  return `Review the following conversation and extract:
1. Any durable facts, preferences, or decisions worth remembering long-term. Save each using the memory_save tool.
2. A concise summary of the conversation for future context.

Conversation:
${messages.map((m) => `${m.role}: ${m.content}`).join('\n\n')}`;
}
