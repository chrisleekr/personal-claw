import { describe, expect, mock, test } from 'bun:test';
import type { HookContext, HookEventType } from '@personalclaw/shared';

describe('HooksEngine', () => {
  test('singleton pattern works via getInstance', async () => {
    const { HooksEngine } = await import('../engine');
    const instance = HooksEngine.getInstance();
    expect(instance).toBeDefined();
    expect(typeof instance.on).toBe('function');
    expect(typeof instance.emit).toBe('function');
  });

  test('on registers handler and emit calls it, returning successCount=1', async () => {
    const { HooksEngine } = await import('../engine');
    const engine = HooksEngine.getInstance();
    const handler = mock(async () => {});
    const event = `test:event:${Date.now()}` as HookEventType;
    engine.on(event, handler);
    const ctx: HookContext = {
      channelId: 'ch-1',
      externalUserId: 'user-1',
      threadId: 'thread-1',
      eventType: event,
      payload: { test: true },
    };
    const result = await engine.emit(event, ctx);
    expect(handler).toHaveBeenCalledWith(ctx);
    expect(result.successCount).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  test('emit returns empty result for unregistered events', async () => {
    const { HooksEngine } = await import('../engine');
    const engine = HooksEngine.getInstance();
    const ctx: HookContext = {
      channelId: 'ch-1',
      externalUserId: 'user-1',
      threadId: 'thread-1',
      eventType: `unregistered:${Date.now()}` as HookEventType,
      payload: {},
    };
    const result = await engine.emit(ctx.eventType, ctx);
    expect(result.successCount).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  test('emit runs all handlers even if one throws, aggregating errors (FR-029)', async () => {
    const { HooksEngine } = await import('../engine');
    const engine = HooksEngine.getInstance();
    const event = `test:aggregate:${Date.now()}` as HookEventType;

    const succeededBefore = mock(async () => {});
    const failed = mock(async () => {
      throw new Error('handler bug');
    });
    const succeededAfter = mock(async () => {});

    engine.on(event, succeededBefore);
    engine.on(event, failed);
    engine.on(event, succeededAfter);

    const ctx: HookContext = {
      channelId: 'ch-1',
      externalUserId: 'user-1',
      threadId: 'thread-1',
      eventType: event,
      payload: {},
    };

    const result = await engine.emit(event, ctx);

    // All three handlers were invoked, even though the middle one threw.
    expect(succeededBefore).toHaveBeenCalled();
    expect(failed).toHaveBeenCalled();
    expect(succeededAfter).toHaveBeenCalled();

    // Failure is surfaced in the result, not silently swallowed.
    expect(result.successCount).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].handlerIndex).toBe(1);
    expect(result.errors[0].event).toBe(event);
    expect(result.errors[0].error.message).toBe('handler bug');
  });

  test('emit wraps non-Error throws into Error instances', async () => {
    const { HooksEngine } = await import('../engine');
    const engine = HooksEngine.getInstance();
    const event = `test:nonerror:${Date.now()}` as HookEventType;

    engine.on(event, async () => {
      // Deliberately throwing a non-Error string to test the wrapping behavior in HooksEngine.emit().
      throw 'string error';
    });

    const result = await engine.emit(event, {
      channelId: 'ch-1',
      externalUserId: 'user-1',
      threadId: 'thread-1',
      eventType: event,
      payload: {},
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toBeInstanceOf(Error);
    expect(result.errors[0].error.message).toBe('string error');
  });
});
