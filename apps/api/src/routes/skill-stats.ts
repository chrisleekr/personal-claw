import { Hono } from 'hono';
import { services } from '../services/container';

const skillService = services.skills;

export const skillStatsRoute = new Hono();

skillStatsRoute.get('/:channelId/stats', async (c) => {
  const channelId = c.req.param('channelId');
  const stats = await skillService.getStats(channelId);
  return c.json({ data: stats });
});
