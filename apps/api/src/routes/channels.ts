import { createChannelSchema, updateChannelSchema } from '@personalclaw/shared';
import { Hono } from 'hono';
import { services } from '../services/container';

const channelService = services.channels;

export const channelsRoute = new Hono();

channelsRoute.get('/', async (c) => {
  const rows = await channelService.list();
  return c.json({ data: rows });
});

channelsRoute.get('/:id', async (c) => {
  const row = await channelService.getById(c.req.param('id'));
  return c.json({ data: row });
});

channelsRoute.post('/', async (c) => {
  const input = createChannelSchema.parse(await c.req.json());
  const row = await channelService.create(input);
  return c.json({ data: row }, 201);
});

channelsRoute.put('/:id', async (c) => {
  const input = updateChannelSchema.parse(await c.req.json());
  const row = await channelService.update(c.req.param('id'), input);
  return c.json({ data: row });
});

channelsRoute.delete('/:id', async (c) => {
  await channelService.delete(c.req.param('id'));
  return c.json({ data: { deleted: true } });
});
