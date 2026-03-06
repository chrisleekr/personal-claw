import { createMCPClient } from '@ai-sdk/mcp';
import { getLogger } from '@logtape/logtape';
import { eq, isNull, or, toolPolicies } from '@personalclaw/db';
import type { ToolSet } from 'ai';
import { getDb } from '../db';
import { errorDetails } from '../utils/error-fmt';
import { buildTransport, loadMCPConfigs, type MCPServerConfig } from './config';

const logger = getLogger(['personalclaw', 'mcp', 'manager']);

interface CachedMCPClient {
  client: Awaited<ReturnType<typeof createMCPClient>>;
  config: MCPServerConfig;
}

export class MCPManager {
  private clientCache = new Map<string, CachedMCPClient>();

  async getToolsForChannel(channelId: string): Promise<ToolSet> {
    const configs = await loadMCPConfigs(channelId);
    if (configs.length === 0) return {};

    const policies = await this.loadToolPolicies(channelId);
    const allTools: ToolSet = {};

    for (const config of configs) {
      try {
        const client = await this.getOrCreateClient(config);
        const tools = await client.client.tools();

        const policy = policies.get(config.id);
        for (const [name, tool] of Object.entries(tools)) {
          if (policy) {
            if (policy.denyList.length > 0 && policy.denyList.includes(name)) continue;
            if (policy.allowList.length > 0 && !policy.allowList.includes(name)) continue;
          }
          const sanitizedServer = config.serverName.replace(/[^a-zA-Z0-9_-]/g, '-');
          allTools[`${sanitizedServer}__${name}`] = tool;
        }
      } catch (error) {
        logger.error('Failed to load MCP tools', {
          serverName: config.serverName,
          channelId: config.channelId,
          transport: config.transportType,
          ...errorDetails(error),
        });
      }
    }

    return allTools;
  }

  private async getOrCreateClient(config: MCPServerConfig): Promise<CachedMCPClient> {
    const cacheKey =
      config.transportType === 'stdio'
        ? `stdio:${config.command}:${config.serverName}`
        : `${config.serverUrl}:${config.serverName}`;
    const cached = this.clientCache.get(cacheKey);
    if (cached) return cached;

    const transport = buildTransport(config);
    const client = await createMCPClient({ transport });
    const entry: CachedMCPClient = { client, config };
    this.clientCache.set(cacheKey, entry);
    logger.info`Connected to MCP server "${config.serverName}" via ${config.transportType}`;
    return entry;
  }

  private async loadToolPolicies(
    channelId: string,
  ): Promise<Map<string, { allowList: string[]; denyList: string[] }>> {
    try {
      const db = getDb();
      const rows = await db
        .select()
        .from(toolPolicies)
        .where(or(isNull(toolPolicies.channelId), eq(toolPolicies.channelId, channelId)));

      const merged = new Map<string, { allowList: string[]; denyList: string[] }>();
      for (const r of rows) {
        const isGlobal = r.channelId === null;
        const existing = merged.get(r.mcpConfigId);
        if (!existing || !isGlobal) {
          merged.set(r.mcpConfigId, { allowList: r.allowList, denyList: r.denyList });
        }
      }
      return merged;
    } catch (error) {
      logger.warn('Failed to load tool policies', { channelId, ...errorDetails(error) });
      return new Map();
    }
  }

  invalidateChannel(channelId: string): void {
    for (const [key, entry] of this.clientCache.entries()) {
      if (entry.config.channelId === channelId) {
        entry.client.close?.();
        this.clientCache.delete(key);
      }
    }
    logger.info`Invalidated MCP clients for channel ${channelId}`;
  }

  invalidateAll(): void {
    for (const [, entry] of this.clientCache.entries()) {
      entry.client.close?.();
    }
    this.clientCache.clear();
    logger.info`Invalidated all MCP clients`;
  }

  async closeAll(): Promise<void> {
    for (const [, entry] of this.clientCache.entries()) {
      entry.client.close?.();
    }
    this.clientCache.clear();
  }
}
