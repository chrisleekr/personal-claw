import { getLogger } from '@logtape/logtape';
import type { HookContext, HookEventType } from '@personalclaw/shared';
import { errorDetails } from '../utils/error-fmt';

const logger = getLogger(['personalclaw', 'hooks', 'engine']);

type HookHandler = (context: HookContext) => Promise<void>;

/**
 * Structured result of a hook emission. Returned by `HooksEngine.emit()` so
 * callers can explicitly inspect whether every registered handler succeeded.
 *
 * Per Constitution VI (Security by Default) and FR-017/FR-029, handler
 * failures MUST NOT be silently swallowed. The previous version of
 * `emit()` wrapped every handler call in a blanket `try/catch` that logged
 * and continued; this structure replaces that pattern while still running
 * every registered handler (so one broken handler cannot starve the others).
 *
 * Call-site responsibilities:
 * - Low-priority emissions may `void` the returned result to explicitly
 *   acknowledge they are not inspecting it.
 * - Audit-critical emissions MUST inspect `errors.length` and react
 *   appropriately (log, alert, or fail the surrounding operation).
 *
 * Errors are still logged inside `emit()` for observability, but the log
 * line is in addition to — not a replacement for — the caller's inspection.
 */
export interface HookEmitResult {
  successCount: number;
  errors: Array<{
    handlerIndex: number;
    event: HookEventType;
    error: Error;
  }>;
}

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

  /**
   * Invokes every registered handler for the given event, aggregating any
   * errors into the returned `HookEmitResult`.
   *
   * Every handler is invoked exactly once, even if an earlier handler threw —
   * this preserves the guarantee that attaching a broken handler cannot
   * starve other handlers (e.g., the audit-trail handler must still see
   * events even if the cost-log handler has a bug).
   *
   * Callers that do not care about handler failures should explicitly
   * discard the result with `void (await hooks.emit(...))` or by assigning
   * to an unused variable. Silent discard via a bare call is still allowed
   * but discouraged — the explicit acknowledgement makes intent visible to
   * reviewers.
   */
  async emit(event: HookEventType, context: HookContext): Promise<HookEmitResult> {
    const handlers = this.handlers.get(event) || [];
    const result: HookEmitResult = { successCount: 0, errors: [] };

    for (let i = 0; i < handlers.length; i++) {
      const handler = handlers[i];
      try {
        await handler(context);
        result.successCount++;
      } catch (rawError) {
        const error = rawError instanceof Error ? rawError : new Error(String(rawError));
        result.errors.push({ handlerIndex: i, event, error });
        logger.error('Hook handler failed', {
          event,
          handlerIndex: i,
          ...errorDetails(error),
        });
      }
    }

    return result;
  }
}
