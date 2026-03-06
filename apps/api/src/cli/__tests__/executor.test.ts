import { describe, expect, test } from 'bun:test';
import type { CLIToolDefinition } from '@personalclaw/shared';
import { executeCLI } from '../executor';

const echoDef: CLIToolDefinition = {
  name: 'test_echo',
  binary: 'echo',
  description: 'Echo text',
  allowedPatterns: [/.*/],
  deniedPatterns: [],
  timeoutMs: 5000,
};

describe('executeCLI', () => {
  test('executes echo command and returns stdout', async () => {
    const result = await executeCLI(echoDef, 'hello world');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello world');
    expect(result.stderr).toBe('');
  });

  test('handles quoted arguments', async () => {
    const result = await executeCLI(echoDef, '"hello world"');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello world');
  });

  test('returns non-zero exit code for failing command', async () => {
    const falseDef: CLIToolDefinition = {
      ...echoDef,
      name: 'test_false',
      binary: 'false',
    };
    const result = await executeCLI(falseDef, '');
    expect(result.exitCode).not.toBe(0);
  });

  test('returns error for non-existent binary', async () => {
    const badDef: CLIToolDefinition = {
      ...echoDef,
      name: 'test_bad',
      binary: 'nonexistent_binary_xyz_123',
    };
    const result = await executeCLI(badDef, 'test');
    expect(result.exitCode).not.toBe(0);
  });
});
