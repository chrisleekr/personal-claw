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

/**
 * Appends the message:sent event as a JSONL line to the per-channel transcript
 * file. Per FR-029, this handler catches only the narrow set of filesystem
 * errors that can legitimately occur when writing to disk — any other error
 * (bug in `maskPiiInObject`, bad event shape, etc.) bubbles up through
 * `HooksEngine.emit()` so the caller can see it in the aggregated result.
 *
 * Constitution VII still requires structured logging of transcript failures,
 * which is why we log the NodeJS errno path with context; the throw + log
 * combination lets operators see the failure immediately while also giving
 * the emit caller a structured error they can react to.
 */
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

  const maskedEntry = maskPiiInObject(entry);

  try {
    await mkdir(dir, { recursive: true });
    await appendFile(filePath, `${JSON.stringify(maskedEntry)}\n`);
  } catch (rawError) {
    // Only swallow NodeJS filesystem errors (errno present). Anything else is
    // an unexpected defect and MUST bubble per FR-029 / FR-017.
    const hasErrno =
      rawError !== null &&
      typeof rawError === 'object' &&
      'code' in rawError &&
      typeof (rawError as { code: unknown }).code === 'string';
    if (!hasErrno) {
      throw rawError;
    }
    logger.error('Failed to write transcript (fs error)', {
      channelId: ctx.channelId,
      filePath,
      ...errorDetails(rawError),
    });
  }
});
