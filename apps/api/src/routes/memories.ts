import { updateMemorySchema } from '@personalclaw/shared';
import { Hono } from 'hono';
import { services } from '../services/container';

const memoryService = services.memories;

export const memoriesRoute = new Hono();

memoriesRoute.get('/:channelId', async (c) => {
  const rows = await memoryService.listByChannel(c.req.param('channelId'));
  return c.json({ data: rows });
});

memoriesRoute.get('/:channelId/search', async (c) => {
  const query = c.req.query('q') ?? '';
  const rows = await memoryService.search(c.req.param('channelId'), query);
  return c.json({ data: rows });
});

memoriesRoute.patch('/:channelId/:id', async (c) => {
  const input = updateMemorySchema.parse(await c.req.json());
  const row = await memoryService.updateScoped(c.req.param('channelId'), c.req.param('id'), input);
  return c.json({ data: row });
});

memoriesRoute.delete('/:channelId/:id', async (c) => {
  await memoryService.deleteScoped(c.req.param('channelId'), c.req.param('id'));
  return c.json({ data: { deleted: true } });
});
