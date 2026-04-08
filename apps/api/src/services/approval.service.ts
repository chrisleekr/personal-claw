import { approvalPolicies, eq } from '@personalclaw/db';
import type { CreateApprovalPolicyInput } from '@personalclaw/shared';
import { z } from 'zod';
import { getDb } from '../db';
import { NotFoundError } from '../errors/app-error';

export const updateApprovalPolicySchema = z.object({
  policy: z.enum(['ask', 'allowlist', 'deny', 'auto']).optional(),
  allowedUsers: z.array(z.string()).optional(),
});

export type UpdateApprovalPolicyInput = z.infer<typeof updateApprovalPolicySchema>;

export class ApprovalService {
  async listByChannel(channelId: string) {
    const db = getDb();
    return db
      .select()
      .from(approvalPolicies)
      .where(eq(approvalPolicies.channelId, channelId))
      .orderBy(approvalPolicies.createdAt);
  }

  async create(input: CreateApprovalPolicyInput) {
    const db = getDb();
    const [row] = await db.insert(approvalPolicies).values(input).returning();
    return row;
  }

  async update(id: string, input: UpdateApprovalPolicyInput) {
    const db = getDb();
    const [row] = await db
      .update(approvalPolicies)
      .set(input)
      .where(eq(approvalPolicies.id, id))
      .returning();
    if (!row) throw new NotFoundError('Approval policy', id);
    return row;
  }

  async delete(id: string) {
    const db = getDb();
    const [row] = await db.delete(approvalPolicies).where(eq(approvalPolicies.id, id)).returning();
    if (!row) throw new NotFoundError('Approval policy', id);
  }

  async updateScoped(channelId: string, id: string, input: UpdateApprovalPolicyInput) {
    const db = getDb();
    const [existing] = await db.select().from(approvalPolicies).where(eq(approvalPolicies.id, id));
    if (!existing) throw new NotFoundError('Approval policy', id);
    if (existing.channelId !== channelId) throw new NotFoundError('Approval policy', id);
    return this.update(id, input);
  }

  async deleteScoped(channelId: string, id: string) {
    const db = getDb();
    const [existing] = await db.select().from(approvalPolicies).where(eq(approvalPolicies.id, id));
    if (!existing) throw new NotFoundError('Approval policy', id);
    if (existing.channelId !== channelId) throw new NotFoundError('Approval policy', id);
    return this.delete(id);
  }
}
