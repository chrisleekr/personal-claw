import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, renderHook } from '@testing-library/react';
import { useConfigUpdates } from '../use-config-updates';

afterEach(cleanup);

describe('useConfigUpdates', () => {
  test('does not connect when channelId is undefined', () => {
    const onUpdate = mock(() => {});
    const { unmount } = renderHook(() => useConfigUpdates(undefined, onUpdate));
    expect(onUpdate).not.toHaveBeenCalled();
    unmount();
  });

  test('accepts a channelId and onUpdate callback', () => {
    const onUpdate = mock(() => {});
    const { unmount } = renderHook(() => useConfigUpdates('ch-001', onUpdate));
    expect(onUpdate).not.toHaveBeenCalled();
    unmount();
  });
});
