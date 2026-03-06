import { describe, expect, test } from 'bun:test';
import { classifyReaction } from '../feedback';

describe('classifyReaction', () => {
  test('returns positive for thumbsup reactions', () => {
    expect(classifyReaction('+1')).toBe('positive');
    expect(classifyReaction('thumbsup')).toBe('positive');
    expect(classifyReaction('white_check_mark')).toBe('positive');
    expect(classifyReaction('heart')).toBe('positive');
    expect(classifyReaction('tada')).toBe('positive');
  });

  test('returns negative for thumbsdown reactions', () => {
    expect(classifyReaction('-1')).toBe('negative');
    expect(classifyReaction('thumbsdown')).toBe('negative');
    expect(classifyReaction('x')).toBe('negative');
  });

  test('returns null for unknown reactions', () => {
    expect(classifyReaction('thinking_face')).toBeNull();
    expect(classifyReaction('eyes')).toBeNull();
    expect(classifyReaction('fire')).toBeNull();
    expect(classifyReaction('')).toBeNull();
  });
});
