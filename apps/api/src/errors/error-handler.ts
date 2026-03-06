import { getLogger } from '@logtape/logtape';
import type { Context } from 'hono';
import { ZodError } from 'zod';
import { errorDetails } from '../utils/error-fmt';
import { AppError } from './app-error';

const logger = getLogger(['personalclaw', 'errors']);

export function errorHandler(err: Error, c: Context) {
  if (err instanceof ZodError) {
    return c.json(
      {
        error: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      },
      400,
    );
  }

  if (err instanceof AppError) {
    return c.json(
      { error: err.code, message: err.message },
      err.statusCode as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502,
    );
  }

  logger.error('Unhandled error', { path: c.req.path, method: c.req.method, ...errorDetails(err) });
  return c.json({ error: 'INTERNAL', message: 'Internal server error' }, 500);
}
