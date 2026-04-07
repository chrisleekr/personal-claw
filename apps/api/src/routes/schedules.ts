import { createScheduleSchema } from '@personalclaw/shared';
import { Hono } from 'hono';
import { services } from '../services/container';
import { updateScheduleSchema } from '../services/schedule.service';

const scheduleService = services.schedules;

export const schedulesRoute = new Hono();

schedulesRoute.get('/:channelId', async (c) => {
  const rows = await scheduleService.listByChannel(c.req.param('channelId'));
  return c.json({ data: rows });
});

schedulesRoute.post('/', async (c) => {
  const input = createScheduleSchema.parse(await c.req.json());
  const row = await scheduleService.create(input);
  return c.json({ data: row }, 201);
});

schedulesRoute.put('/:channelId/:id', async (c) => {
  const input = updateScheduleSchema.parse(await c.req.json());
  const row = await scheduleService.updateScoped(
    c.req.param('channelId'),
    c.req.param('id'),
    input,
  );
  return c.json({ data: row });
});

schedulesRoute.delete('/:channelId/:id', async (c) => {
  await scheduleService.deleteScoped(c.req.param('channelId'), c.req.param('id'));
  return c.json({ data: { deleted: true } });
});
