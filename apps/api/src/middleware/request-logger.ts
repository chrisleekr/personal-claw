import { getLogger } from '@logtape/logtape';
import type { MiddlewareHandler } from 'hono';
import { errorDetails } from '../utils/error-fmt';
import { maskPII, maskPiiInObject } from '../utils/pii-masker';

const logger = getLogger(['personalclaw', 'http', 'body']);

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH']);

export const requestBodyLogger: MiddlewareHandler = async (c, next) => {
  if (!METHODS_WITH_BODY.has(c.req.method) || c.req.path === '/health') {
    return next();
  }

  const contentType = c.req.header('content-type') ?? '';

  try {
    if (contentType.includes('application/json')) {
      const cloned = c.req.raw.clone();
      const text = await cloned.text();
      if (!text) return next();
      const body = JSON.parse(text);
      const masked = maskPiiInObject(body);
      logger.info('Request body', {
        method: c.req.method,
        path: c.req.path,
        contentType,
        body: masked,
      });
    } else if (contentType.includes('text/')) {
      const cloned = c.req.raw.clone();
      const text = await cloned.text();
      logger.info('Request body', {
        method: c.req.method,
        path: c.req.path,
        contentType,
        body: maskPII(text),
      });
    } else {
      logger.info('Request body', {
        method: c.req.method,
        path: c.req.path,
        contentType,
        body: '[non-text body]',
      });
    }
  } catch (error) {
    logger.warn('Failed to read request body for logging', {
      method: c.req.method,
      path: c.req.path,
      ...errorDetails(error),
    });
  }

  return next();
};
