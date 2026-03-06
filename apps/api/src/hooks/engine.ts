import { getLogger } from '@logtape/logtape';
import type { HookContext, HookEventType } from '@personalclaw/shared';
import { errorDetails } from '../utils/error-fmt';

const logger = getLogger(['personalclaw', 'hooks', 'engine']);

type HookHandler = (context: HookContext) => Promise<void>;

export class HooksEngine {
  private static instance: HooksEngine;
  private handlers = new Map<HookEventType, HookHandler[]>();

  static getInstance(): HooksEngine {
    if (!HooksEngine.instance) {
      HooksEngine.instance = new HooksEngine();
    }
    return HooksEngine.instance;
  }

  on(event: HookEventType, handler: HookHandler): void {
    const existing = this.handlers.get(event) || [];
    existing.push(handler);
    this.handlers.set(event, existing);
  }

  async emit(event: HookEventType, context: HookContext): Promise<void> {
    const handlers = this.handlers.get(event) || [];
    for (const handler of handlers) {
      try {
        await handler(context);
      } catch (error) {
        logger.error('Hook handler failed', { event, ...errorDetails(error) });
      }
    }
  }
}
