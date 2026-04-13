import { getLogger } from '@logtape/logtape';
import { HooksEngine } from '../engine';

const logger = getLogger(['personalclaw', 'hooks', 'cost']);
const hooks = HooksEngine.getInstance();

/**
 * Logs per-turn token and cost metadata from the `message:sent` event.
 *
 * Per FR-029 this handler has no blanket try/catch — any unexpected error
 * (bad type coercion, logger failure, etc.) bubbles up through
 * `HooksEngine.emit()` to the caller. The type casts below are defensive
 * reads of the payload which is typed as `Record<string, unknown>` at the
 * hook boundary.
 */
hooks.on('message:sent', async (ctx) => {
  const cost = ctx.payload.cost as number | undefined;
  const tokens = ctx.payload.tokens as number | undefined;
  const model = ctx.payload.model as string | undefined;

  if (cost !== undefined || tokens !== undefined) {
    logger.info('Cost log', {
      channelId: ctx.channelId,
      userId: ctx.externalUserId,
      model: model ?? 'unknown',
      tokens: tokens ?? 0,
      cost: (cost ?? 0).toFixed(6),
    });
  }
});
