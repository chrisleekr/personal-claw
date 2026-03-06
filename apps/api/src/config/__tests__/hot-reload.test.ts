import { describe, expect, mock, test } from 'bun:test';

describe('hot-reload', () => {
  test('onConfigChange and emitConfigChange work together', async () => {
    const { onConfigChange, emitConfigChange } = await import('../hot-reload');
    const handler = mock(() => {});
    onConfigChange(handler);
    emitConfigChange('ch-test-1', 'identity');
    expect(handler).toHaveBeenCalledWith('ch-test-1', 'identity');
  });

  test('emitConfigChange calls multiple handlers', async () => {
    const { onConfigChange, emitConfigChange } = await import('../hot-reload');
    const h1 = mock(() => {});
    const h2 = mock(() => {});
    onConfigChange(h1);
    onConfigChange(h2);
    emitConfigChange('ch-test-2', 'mcp');
    expect(h1).toHaveBeenCalled();
    expect(h2).toHaveBeenCalled();
  });
});
