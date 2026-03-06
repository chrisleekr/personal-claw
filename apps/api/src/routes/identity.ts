import { Hono } from 'hono';
import { services } from '../services/container';
import { updateIdentitySchema } from '../services/identity.service';

const identityService = services.identity;

export const identityRoute = new Hono();

identityRoute.get('/:channelId', async (c) => {
  const row = await identityService.getByChannel(c.req.param('channelId'));
  return c.json({ data: row });
});

identityRoute.put('/:channelId', async (c) => {
  const input = updateIdentitySchema.parse(await c.req.json());
  const row = await identityService.update(c.req.param('channelId'), input);
  return c.json({ data: row });
});
