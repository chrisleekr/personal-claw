import { Hono } from 'hono';
import { getModelPricing, listRegisteredModels } from '../agent/pricing';
import { services } from '../services/container';

const usageService = services.usage;

export const usageRoute = new Hono();

usageRoute.get('/pricing', (c) => {
  const data = listRegisteredModels().map((model) => ({
    model,
    pricing: getModelPricing(model),
  }));
  return c.json({ data });
});

usageRoute.get('/:channelId', async (c) => {
  const data = await usageService.getUsage(c.req.param('channelId'));
  return c.json({ data });
});

usageRoute.get('/:channelId/budget', async (c) => {
  const data = await usageService.getBudget(c.req.param('channelId'));
  return c.json({ data });
});

usageRoute.get('/:channelId/daily', async (c) => {
  const data = await usageService.getDailyAggregates(c.req.param('channelId'));
  return c.json({ data });
});
