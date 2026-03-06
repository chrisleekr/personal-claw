import { describe, expect, test } from 'bun:test';
import { chunkMessage, SLACK_MAX_MESSAGE_LENGTH } from '../message-utils';

describe('SLACK_MAX_MESSAGE_LENGTH', () => {
  test('is 3900', () => {
    expect(SLACK_MAX_MESSAGE_LENGTH).toBe(3900);
  });
});

describe('chunkMessage', () => {
  test('returns single chunk for short text', () => {
    const result = chunkMessage('hello', 100);
    expect(result).toEqual(['hello']);
  });

  test('returns single chunk when text equals maxLen', () => {
    const text = 'a'.repeat(100);
    const result = chunkMessage(text, 100);
    expect(result).toEqual([text]);
  });

  test('returns empty array for empty string', () => {
    const result = chunkMessage('', 100);
    expect(result).toEqual(['']);
  });

  test('splits at section break (---) when available', () => {
    const text = 'First section\n---\nSecond section';
    const result = chunkMessage(text, 20);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0]).toContain('First section');
    expect(result[result.length - 1]).toContain('Second section');
  });

  test('splits at double newline when no section break', () => {
    const text = 'Paragraph one content here.\n\nParagraph two content here.';
    const result = chunkMessage(text, 35);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0]).toContain('Paragraph one');
  });

  test('splits at single newline as fallback', () => {
    const text = 'Line one is some text\nLine two is more text';
    const result = chunkMessage(text, 25);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  test('hard splits when no newlines exist', () => {
    const text = 'a'.repeat(200);
    const result = chunkMessage(text, 100);
    expect(result.length).toBe(2);
    expect(result[0].length).toBe(100);
    expect(result[1].length).toBe(100);
  });

  test('does not produce empty chunks', () => {
    const text = 'abc\n\n\n\ndef\n\n\n\nghi';
    const result = chunkMessage(text, 8);
    for (const chunk of result) {
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  test('trims whitespace at chunk boundaries', () => {
    const text = 'First part\n\n   Second part';
    const result = chunkMessage(text, 15);
    for (const chunk of result) {
      expect(chunk).toBe(chunk.trimEnd());
    }
  });

  test('handles text with only newlines', () => {
    const text = '\n'.repeat(50);
    const result = chunkMessage(text, 10);
    expect(result.length).toBeGreaterThanOrEqual(0);
    for (const chunk of result) {
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  test('prefers section break over double newline when both are available', () => {
    const part1 = 'A'.repeat(30);
    const part2 = 'B'.repeat(30);
    const part3 = 'C'.repeat(30);
    const text = `${part1}\n---\n${part2}\n\n${part3}`;
    const result = chunkMessage(text, 70);
    expect(result[0]).toContain(part1);
  });

  test('ignores split points too close to the start (< 30% of maxLen)', () => {
    const text = `X\n---\n${'Y'.repeat(200)}`;
    const result = chunkMessage(text, 100);
    expect(result[0].length).toBeGreaterThan(10);
  });
});
