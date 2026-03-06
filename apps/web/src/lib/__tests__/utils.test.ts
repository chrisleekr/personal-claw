import { describe, expect, test } from 'bun:test';
import { cn } from '../utils';

describe('cn', () => {
  test('merges single class', () => {
    expect(cn('text-red-500')).toBe('text-red-500');
  });

  test('merges multiple classes', () => {
    expect(cn('p-4', 'mt-2')).toBe('p-4 mt-2');
  });

  test('handles conditional classes', () => {
    const isActive = true;
    expect(cn('base', isActive && 'active')).toBe('base active');
  });

  test('filters falsy values', () => {
    expect(cn('base', false, null, undefined, 'end')).toBe('base end');
  });

  test('resolves tailwind conflicts (last wins)', () => {
    const result = cn('p-4', 'p-2');
    expect(result).toBe('p-2');
  });

  test('resolves complex tailwind conflicts', () => {
    const result = cn('text-red-500', 'text-blue-500');
    expect(result).toBe('text-blue-500');
  });

  test('handles empty input', () => {
    expect(cn()).toBe('');
  });

  test('handles array input', () => {
    expect(cn(['p-4', 'mt-2'])).toBe('p-4 mt-2');
  });
});
