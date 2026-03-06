import { describe, expect, test } from 'bun:test';
import { withThreadLock } from '../thread-lock';

describe('withThreadLock', () => {
  test('executes function and returns result', async () => {
    const result = await withThreadLock('t1', async () => 42);
    expect(result).toBe(42);
  });

  test('serializes concurrent calls for same threadId', async () => {
    const order: number[] = [];
    const a = withThreadLock('t2', async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push(1);
    });
    const b = withThreadLock('t2', async () => {
      order.push(2);
    });
    await Promise.all([a, b]);
    expect(order).toEqual([1, 2]);
  });

  test('allows parallel execution for different threadIds', async () => {
    const order: number[] = [];
    const a = withThreadLock('t3', async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push(1);
    });
    const b = withThreadLock('t4', async () => {
      order.push(2);
    });
    await Promise.all([a, b]);
    expect(order).toEqual([2, 1]);
  });

  test('releases lock even if function throws', async () => {
    try {
      await withThreadLock('t5', async () => {
        throw new Error('fail');
      });
    } catch {
      // expected
    }
    const result = await withThreadLock('t5', async () => 'recovered');
    expect(result).toBe('recovered');
  });

  test('propagates thrown error', async () => {
    expect(
      withThreadLock('t6', async () => {
        throw new Error('test error');
      }),
    ).rejects.toThrow('test error');
  });
});
