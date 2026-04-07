import { createSkillSchema, updateSkillSchema } from '@personalclaw/shared';
import { Hono } from 'hono';
import { services } from '../services/container';

const skillService = services.skills;

export const skillsRoute = new Hono();

skillsRoute.get('/:channelId', async (c) => {
  const rows = await skillService.listByChannel(c.req.param('channelId'));
  return c.json({ data: rows });
});

skillsRoute.post('/', async (c) => {
  const input = createSkillSchema.parse(await c.req.json());
  const row = await skillService.create(input);
  return c.json({ data: row }, 201);
});

skillsRoute.put('/:channelId/:id', async (c) => {
  const input = updateSkillSchema.parse(await c.req.json());
  const row = await skillService.updateScoped(c.req.param('channelId'), c.req.param('id'), input);
  return c.json({ data: row });
});

skillsRoute.delete('/:channelId/:id', async (c) => {
  await skillService.deleteScoped(c.req.param('channelId'), c.req.param('id'));
  return c.json({ data: { deleted: true } });
});
