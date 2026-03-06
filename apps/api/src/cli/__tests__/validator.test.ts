import { describe, expect, test } from 'bun:test';
import type { CLIToolDefinition } from '@personalclaw/shared';
import { validateCommand } from '../validator';

const baseDef: CLIToolDefinition = {
  name: 'test-tool',
  binary: 'test-bin',
  description: 'A test tool',
  allowedPatterns: [/^list/, /^get\s/],
  deniedPatterns: [/--force/, /--delete-all/],
  timeoutMs: 30000,
};

describe('validateCommand', () => {
  test('accepts valid command matching allowed pattern', () => {
    const result = validateCommand('list items', baseDef);
    expect(result).toEqual({ valid: true });
  });

  test('accepts another allowed pattern', () => {
    const result = validateCommand('get resource-123', baseDef);
    expect(result).toEqual({ valid: true });
  });

  test('rejects empty command', () => {
    const result = validateCommand('', baseDef);
    expect(result).toEqual({ valid: false, reason: 'Empty command' });
  });

  test('rejects whitespace-only command', () => {
    const result = validateCommand('   ', baseDef);
    expect(result).toEqual({ valid: false, reason: 'Empty command' });
  });

  test('rejects semicolons (shell metacharacter)', () => {
    const result = validateCommand('list; rm -rf /', baseDef);
    expect(result).toEqual({ valid: false, reason: 'Shell metacharacters are not allowed' });
  });

  test('rejects pipes', () => {
    const result = validateCommand('list | cat', baseDef);
    expect(result).toEqual({ valid: false, reason: 'Shell metacharacters are not allowed' });
  });

  test('rejects ampersands', () => {
    const result = validateCommand('list && echo hacked', baseDef);
    expect(result).toEqual({ valid: false, reason: 'Shell metacharacters are not allowed' });
  });

  test('rejects backticks', () => {
    const result = validateCommand('list `whoami`', baseDef);
    expect(result).toEqual({ valid: false, reason: 'Shell metacharacters are not allowed' });
  });

  test('rejects dollar sign', () => {
    const result = validateCommand('list $HOME', baseDef);
    expect(result).toEqual({ valid: false, reason: 'Shell metacharacters are not allowed' });
  });

  test('rejects command substitution $(...)', () => {
    const result = validateCommand('list $(whoami)', baseDef);
    expect(result).toEqual({ valid: false, reason: 'Shell metacharacters are not allowed' });
  });

  test('rejects command matching denied pattern', () => {
    const result = validateCommand('list --force', baseDef);
    expect(result.valid).toBe(false);
    expect((result as { valid: false; reason: string }).reason).toContain('denied pattern');
    expect((result as { valid: false; reason: string }).reason).toContain('--force');
  });

  test('rejects another denied pattern', () => {
    const result = validateCommand('list --delete-all', baseDef);
    expect(result.valid).toBe(false);
    expect((result as { valid: false; reason: string }).reason).toContain('denied pattern');
  });

  test('rejects command not matching any allowed pattern', () => {
    const result = validateCommand('delete everything', baseDef);
    expect(result.valid).toBe(false);
    expect((result as { valid: false; reason: string }).reason).toContain(
      'does not match any allowed pattern',
    );
    expect((result as { valid: false; reason: string }).reason).toContain('test-bin');
  });

  test('trims leading/trailing whitespace before validation', () => {
    const result = validateCommand('  list items  ', baseDef);
    expect(result).toEqual({ valid: true });
  });

  test('denied patterns take priority over allowed patterns', () => {
    const def: CLIToolDefinition = {
      ...baseDef,
      allowedPatterns: [/^list/],
      deniedPatterns: [/^list/],
    };
    const result = validateCommand('list', def);
    expect(result.valid).toBe(false);
    expect((result as { valid: false; reason: string }).reason).toContain('denied pattern');
  });
});
