import { createMCPConfigSchema, updateToolPolicySchema } from '@personalclaw/shared';
import { Hono } from 'hono';
import { ValidationError } from '../errors/app-error';
import { services } from '../services/container';
import { updateMCPConfigSchema } from '../services/mcp.service';

const mcpService = services.mcp;

export const mcpRoute = new Hono();

mcpRoute.get('/', async (c) => {
  const rows = await mcpService.listGlobal();
  return c.json({ data: rows });
});

mcpRoute.get('/channel/:channelId', async (c) => {
  const rows = await mcpService.listByChannel(c.req.param('channelId'));
  return c.json({ data: rows });
});

mcpRoute.post('/', async (c) => {
  const input = createMCPConfigSchema.parse(await c.req.json());
  const row = await mcpService.create(input);
  return c.json({ data: row }, 201);
});

mcpRoute.put('/:id', async (c) => {
  const input = updateMCPConfigSchema.parse(await c.req.json());
  const row = await mcpService.update(c.req.param('id'), input);
  return c.json({ data: row });
});

mcpRoute.delete('/:id', async (c) => {
  await mcpService.delete(c.req.param('id'));
  return c.json({ data: { deleted: true } });
});

mcpRoute.post('/:id/test', async (c) => {
  try {
    const result = await mcpService.testConnection(c.req.param('id'));
    return c.json({ data: result });
  } catch (error) {
    return c.json({ error: 'Connection failed', message: (error as Error).message }, 400);
  }
});

mcpRoute.get('/:id/tools', async (c) => {
  try {
    const tools = await mcpService.listTools(c.req.param('id'));
    return c.json({ data: tools });
  } catch (error) {
    return c.json({ error: 'Connection failed', message: (error as Error).message }, 400);
  }
});

mcpRoute.get('/:id/tool-policy', async (c) => {
  const channelId = c.req.query('channelId') ?? null;
  const data = await mcpService.getToolPolicy(c.req.param('id'), channelId);
  return c.json({ data });
});

mcpRoute.put('/:id/tool-policy', async (c) => {
  const input = updateToolPolicySchema.parse(await c.req.json());
  const row = await mcpService.upsertToolPolicy(
    c.req.param('id'),
    input.channelId,
    input.disabledTools,
  );
  return c.json({ data: row });
});

mcpRoute.delete('/:id/tool-policy', async (c) => {
  const channelId = c.req.query('channelId') ?? null;
  if (!channelId) {
    throw new ValidationError('channelId query param required for reset');
  }
  await mcpService.deleteToolPolicy(c.req.param('id'), channelId);
  return c.json({ data: { deleted: true } });
});
