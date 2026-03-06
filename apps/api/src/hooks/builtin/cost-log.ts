import { getLogger } from '@logtape/logtape';
import { HooksEngine } from '../engine';

const logger = getLogger(['personalclaw', 'hooks', 'cost']);
const hooks = HooksEngine.getInstance();

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
