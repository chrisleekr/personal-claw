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

  test('on registers handler and emit calls it', async () => {
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
    await engine.emit(event, ctx);
    expect(handler).toHaveBeenCalledWith(ctx);
  });

  test('emit does nothing for unregistered events', async () => {
    const { HooksEngine } = await import('../engine');
    const engine = HooksEngine.getInstance();
    const ctx: HookContext = {
      channelId: 'ch-1',
      externalUserId: 'user-1',
      threadId: 'thread-1',
      eventType: `unregistered:${Date.now()}` as HookEventType,
      payload: {},
    };
    await expect(engine.emit(ctx.eventType, ctx)).resolves.toBeUndefined();
  });
});
