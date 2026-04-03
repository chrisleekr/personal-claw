import { createMCPClient } from '@ai-sdk/mcp';
import { and, eq, isNull, mcpConfigs, or, toolPolicies } from '@personalclaw/db';
import type { CreateMCPConfigInput, MCPTransportType } from '@personalclaw/shared';
import {
  stdioArgsSchema,
  stdioCommandSchema,
  stdioCwdSchema,
  stdioEnvSchema,
} from '@personalclaw/shared';
import { z } from 'zod';
import { emitConfigChange } from '../config/hot-reload';
import { getDb } from '../db';
import { NotFoundError } from '../errors/app-error';
import { buildTransport, type MCPServerConfig } from '../mcp/config';

export const updateMCPConfigSchema = z
  .object({
    serverName: z.string().min(1).optional(),
    transportType: z.enum(['sse', 'http', 'stdio']).optional(),
    serverUrl: z.string().url().nullable().optional(),
    headers: z.record(z.string()).nullable().optional(),
    command: stdioCommandSchema.nullable().optional(),
    args: stdioArgsSchema.nullable().optional(),
    env: stdioEnvSchema.nullable().optional(),
    cwd: stdioCwdSchema.nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.transportType === 'stdio' && (data.command == null || data.command.trim() === '')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['command'],
        message: 'command is required when transportType is "stdio"',
      });
    }
    if ((data.transportType === 'sse' || data.transportType === 'http') && data.serverUrl == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['serverUrl'],
        message: 'serverUrl is required when transportType is "sse" or "http"',
      });
    }
  });

export type UpdateMCPConfigInput = z.infer<typeof updateMCPConfigSchema>;

function rowToConfig(row: typeof mcpConfigs.$inferSelect): MCPServerConfig {
  return {
    id: row.id,
    serverName: row.serverName,
    transportType: row.transportType as MCPTransportType,
    serverUrl: row.serverUrl,
    headers: (row.headers as Record<string, string>) ?? undefined,
    command: row.command,
    args: (row.args as string[]) ?? null,
    env: (row.env as Record<string, string>) ?? null,
    cwd: row.cwd,
    enabled: row.enabled,
    channelId: row.channelId,
  };
}

export class MCPService {
  async listGlobal() {
    const db = getDb();
    return db
      .select()
      .from(mcpConfigs)
      .where(isNull(mcpConfigs.channelId))
      .orderBy(mcpConfigs.createdAt);
  }

  async listByChannel(channelId: string) {
    const db = getDb();
    return db
      .select()
      .from(mcpConfigs)
      .where(or(isNull(mcpConfigs.channelId), eq(mcpConfigs.channelId, channelId)))
      .orderBy(mcpConfigs.createdAt);
  }

  async create(input: CreateMCPConfigInput) {
    const db = getDb();
    const [row] = await db.insert(mcpConfigs).values(input).returning();
    emitConfigChange(input.channelId ?? '__global__', 'mcp');
    return row;
  }

  async update(id: string, input: UpdateMCPConfigInput) {
    const db = getDb();
    const [row] = await db.update(mcpConfigs).set(input).where(eq(mcpConfigs.id, id)).returning();
    if (!row) throw new NotFoundError('MCP config', id);
    emitConfigChange(row.channelId ?? '__global__', 'mcp');
    return row;
  }

  async delete(id: string) {
    const db = getDb();
    const [row] = await db.delete(mcpConfigs).where(eq(mcpConfigs.id, id)).returning();
    if (!row) throw new NotFoundError('MCP config', id);
    emitConfigChange(row.channelId ?? '__global__', 'mcp');
  }

  async testConnection(id: string) {
    const config = await this.getConfigById(id);
    let client: Awaited<ReturnType<typeof createMCPClient>> | null = null;
    try {
      const transport = buildTransport(config);
      client = await createMCPClient({ transport });
      const tools = await client.tools();
      return { ok: true, toolCount: Object.keys(tools).length };
    } catch (error) {
      throw new Error(`Connection failed: ${(error as Error).message}`);
    } finally {
      client?.close?.();
    }
  }

  async listTools(id: string) {
    const config = await this.getConfigById(id);
    let client: Awaited<ReturnType<typeof createMCPClient>> | null = null;
    try {
      const transport = buildTransport(config);
      client = await createMCPClient({ transport });
      const tools = await client.tools();
      return Object.entries(tools).map(([name, tool]) => ({
        name,
        description: (tool as { description?: string }).description,
      }));
    } catch (error) {
      throw new Error(`Connection failed: ${(error as Error).message}`);
    } finally {
      client?.close?.();
    }
  }

  async getToolPolicy(mcpConfigId: string, channelId: string | null) {
    const db = getDb();
    const channelCondition = channelId
      ? eq(toolPolicies.channelId, channelId)
      : isNull(toolPolicies.channelId);

    const [row] = await db
      .select()
      .from(toolPolicies)
      .where(and(eq(toolPolicies.mcpConfigId, mcpConfigId), channelCondition))
      .limit(1);

    return { disabledTools: row?.denyList ?? [] };
  }

  async upsertToolPolicy(mcpConfigId: string, channelId: string | null, disabledTools: string[]) {
    const db = getDb();
    const channelCondition = channelId
      ? eq(toolPolicies.channelId, channelId)
      : isNull(toolPolicies.channelId);

    const [existing] = await db
      .select()
      .from(toolPolicies)
      .where(and(eq(toolPolicies.mcpConfigId, mcpConfigId), channelCondition))
      .limit(1);

    if (existing) {
      const [row] = await db
        .update(toolPolicies)
        .set({ denyList: disabledTools, allowList: [] })
        .where(eq(toolPolicies.id, existing.id))
        .returning();
      return row;
    }

    const [row] = await db
      .insert(toolPolicies)
      .values({
        mcpConfigId,
        channelId,
        denyList: disabledTools,
        allowList: [],
      })
      .returning();
    return row;
  }

  async deleteToolPolicy(mcpConfigId: string, channelId: string) {
    const db = getDb();
    await db
      .delete(toolPolicies)
      .where(and(eq(toolPolicies.mcpConfigId, mcpConfigId), eq(toolPolicies.channelId, channelId)));
  }

  private async getConfigById(id: string): Promise<MCPServerConfig> {
    const db = getDb();
    const [row] = await db.select().from(mcpConfigs).where(eq(mcpConfigs.id, id)).limit(1);
    if (!row) throw new NotFoundError('MCP config', id);
    return rowToConfig(row);
  }
}
