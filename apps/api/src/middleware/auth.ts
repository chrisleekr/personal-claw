import { getLogger } from '@logtape/logtape';
import type { Context, Next } from 'hono';
import { config } from '../config';

const logger = getLogger(['personalclaw', 'middleware', 'auth']);

export async function authMiddleware(c: Context, next: Next) {
  const secret = config.API_SECRET;
  if (!secret) {
    await next();
    return;
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    logger.debug('Request rejected: missing Authorization header', { path: c.req.path });
    return c.json({ error: 'unauthorized', message: 'Missing Authorization header' }, 401);
  }

  const [scheme, token] = authHeader.split(' ', 2);
  if (scheme !== 'Bearer' || token !== secret) {
    logger.debug('Request rejected: invalid credentials', { path: c.req.path });
    return c.json({ error: 'unauthorized', message: 'Invalid credentials' }, 401);
  }

  await next();
}
