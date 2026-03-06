import { describe, expect, test } from 'bun:test';
import { getCLITools } from '../tools';

describe('getCLITools', () => {
  test('returns a tool for each CLI_REGISTRY entry', () => {
    const tools = getCLITools();
    expect(tools.aws_cli).toBeDefined();
    expect(tools.github_cli).toBeDefined();
    expect(tools.curl_fetch).toBeDefined();
  });

  test('each tool has an execute function', () => {
    const tools = getCLITools();
    for (const [, tool] of Object.entries(tools)) {
      expect(typeof tool.execute).toBe('function');
    }
  });

  test('tool rejects blocked commands', async () => {
    const tools = getCLITools();
    const result = await tools.aws_cli.execute(
      { command: 'rm something' },
      { toolCallId: 'tc-1', messages: [], abortSignal: new AbortController().signal },
    );
    expect((result as Record<string, unknown>).error).toBe(true);
    expect((result as Record<string, unknown>).message).toContain('blocked');
  });
});
