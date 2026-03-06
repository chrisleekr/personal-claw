import { createApprovalPolicySchema } from '@personalclaw/shared';
import { Hono } from 'hono';
import { updateApprovalPolicySchema } from '../services/approval.service';
import { services } from '../services/container';

const approvalService = services.approvals;

export const approvalsRoute = new Hono();

approvalsRoute.get('/:channelId', async (c) => {
  const rows = await approvalService.listByChannel(c.req.param('channelId'));
  return c.json({ data: rows });
});

approvalsRoute.post('/', async (c) => {
  const input = createApprovalPolicySchema.parse(await c.req.json());
  const row = await approvalService.create(input);
  return c.json({ data: row }, 201);
});

approvalsRoute.put('/:id', async (c) => {
  const input = updateApprovalPolicySchema.parse(await c.req.json());
  const row = await approvalService.update(c.req.param('id'), input);
  return c.json({ data: row });
});

approvalsRoute.delete('/:id', async (c) => {
  await approvalService.delete(c.req.param('id'));
  return c.json({ data: { deleted: true } });
});
