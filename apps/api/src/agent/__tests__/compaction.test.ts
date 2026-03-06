import { describe, expect, test } from 'bun:test';
import type { ConversationMessage } from '@personalclaw/shared';
import { COMPACTION_TOKEN_THRESHOLD } from '@personalclaw/shared';
import { buildCompactionPrompt, estimateTokenCount, shouldCompact } from '../compaction';

describe('estimateTokenCount', () => {
  test('returns 0 for empty string', () => {
    expect(estimateTokenCount('')).toBe(0);
  });

  test('returns ceil(length / 4) for short string', () => {
    expect(estimateTokenCount('hello')).toBe(2); // ceil(5/4)
  });

  test('returns exact quarter for length divisible by 4', () => {
    expect(estimateTokenCount('abcd')).toBe(1);
    expect(estimateTokenCount('abcdefgh')).toBe(2);
  });

  test('handles long string', () => {
    const text = 'a'.repeat(1000);
    expect(estimateTokenCount(text)).toBe(250);
  });

  test('rounds up for non-divisible lengths', () => {
    expect(estimateTokenCount('abc')).toBe(1); // ceil(3/4) = 1
    expect(estimateTokenCount('abcde')).toBe(2); // ceil(5/4) = 2
  });
});

describe('shouldCompact', () => {
  test('returns false below threshold', () => {
    expect(shouldCompact(COMPACTION_TOKEN_THRESHOLD - 1)).toBe(false);
  });

  test('returns true at threshold', () => {
    expect(shouldCompact(COMPACTION_TOKEN_THRESHOLD)).toBe(true);
  });

  test('returns true above threshold', () => {
    expect(shouldCompact(COMPACTION_TOKEN_THRESHOLD + 1)).toBe(true);
  });

  test('returns false for zero', () => {
    expect(shouldCompact(0)).toBe(false);
  });
});

describe('buildCompactionPrompt', () => {
  test('produces prompt with no messages', () => {
    const result = buildCompactionPrompt([]);
    expect(result).toContain('Review the following conversation');
    expect(result).toContain('memory_save');
    expect(result).toContain('Conversation:\n');
  });

  test('includes single message role and content', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: 'Hello there', timestamp: '2026-01-01T00:00:00Z' },
    ];
    const result = buildCompactionPrompt(messages);
    expect(result).toContain('user: Hello there');
  });

  test('includes multiple messages separated by double newlines', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: 'What is 2+2?', timestamp: '2026-01-01T00:00:00Z' },
      { role: 'assistant', content: 'It is 4.', timestamp: '2026-01-01T00:00:01Z' },
      { role: 'user', content: 'Thanks!', timestamp: '2026-01-01T00:00:02Z' },
    ];
    const result = buildCompactionPrompt(messages);
    expect(result).toContain('user: What is 2+2?\n\nassistant: It is 4.\n\nuser: Thanks!');
  });

  test('preserves system role messages', () => {
    const messages: ConversationMessage[] = [
      { role: 'system', content: 'You are helpful.', timestamp: '2026-01-01T00:00:00Z' },
    ];
    const result = buildCompactionPrompt(messages);
    expect(result).toContain('system: You are helpful.');
  });
});
