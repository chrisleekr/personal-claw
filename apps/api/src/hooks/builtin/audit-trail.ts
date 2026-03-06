import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getLogger } from '@logtape/logtape';
import { config } from '../../config';
import { errorDetails } from '../../utils/error-fmt';
import { maskPiiInObject } from '../../utils/pii-masker';
import { HooksEngine } from '../engine';

const logger = getLogger(['personalclaw', 'hooks', 'audit']);

const hooks = HooksEngine.getInstance();
const TRANSCRIPT_DIR = config.TRANSCRIPT_DIR;

hooks.on('message:sent', async (ctx) => {
  const entry = {
    timestamp: new Date().toISOString(),
    event: ctx.eventType,
    channelId: ctx.channelId,
    userId: ctx.externalUserId,
    threadId: ctx.threadId,
    ...ctx.payload,
  };

  const date = new Date().toISOString().split('T')[0];
  const dir = join(TRANSCRIPT_DIR, ctx.channelId);
  const filePath = join(dir, `${date}.jsonl`);

  try {
    await mkdir(dir, { recursive: true });
    const maskedEntry = maskPiiInObject(entry);
    await appendFile(filePath, `${JSON.stringify(maskedEntry)}\n`);
  } catch (error) {
    logger.error('Failed to write transcript', {
      channelId: ctx.channelId,
      filePath,
      ...errorDetails(error),
    });
  }
});
