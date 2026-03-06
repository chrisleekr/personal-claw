import { describe, expect, test } from 'bun:test';
import { NoOpAdapter } from '../no-op-adapter';

describe('NoOpAdapter', () => {
  const adapter = new NoOpAdapter();

  test('sendMessage resolves without error', async () => {
    await expect(adapter.sendMessage('thread-1', 'Hello')).resolves.toBeUndefined();
  });

  test('requestApproval always returns true', async () => {
    const result = await adapter.requestApproval({
      threadId: 'thread-1',
      toolName: 'dangerous_tool',
      args: { force: true },
    });
    expect(result).toBe(true);
  });

  test('requestPlanApproval always returns true', async () => {
    const result = await adapter.requestPlanApproval({
      threadId: 'thread-1',
      planSummary: 'Delete everything',
      steps: ['Step 1', 'Step 2'],
    });
    expect(result).toBe(true);
  });
});
