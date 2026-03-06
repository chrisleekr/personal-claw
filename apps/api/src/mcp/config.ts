import type { MCPTransport } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport as StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import { getLogger } from '@logtape/logtape';
import { eq, isNull, mcpConfigs, or } from '@personalclaw/db';
import type { MCPTransportType } from '@personalclaw/shared';
import { mcpTransportTypeSchema } from '@personalclaw/shared';
import { getDb } from '../db';

const logger = getLogger(['personalclaw', 'mcp', 'config']);

export interface MCPServerConfig {
  id: string;
  serverName: string;
  transportType: MCPTransportType;
  serverUrl: string | null;
  headers?: Record<string, string>;
  command: string | null;
  args: string[] | null;
  env: Record<string, string> | null;
  cwd: string | null;
  enabled: boolean;
  channelId: string | null;
}

export function buildTransport(
  config: MCPServerConfig,
): { type: 'sse' | 'http'; url: string; headers?: Record<string, string> } | MCPTransport {
  if (config.transportType === 'stdio') {
    if (!config.command) {
      throw new Error(`MCP config "${config.serverName}" has stdio transport but no command`);
    }
    return new StdioMCPTransport({
      command: config.command,
      ...(config.args ? { args: config.args } : {}),
      ...(config.env ? { env: config.env } : {}),
      ...(config.cwd ? { cwd: config.cwd } : {}),
    });
  }

  if (!config.serverUrl) {
    throw new Error(
      `MCP config "${config.serverName}" has ${config.transportType} transport but no serverUrl`,
    );
  }
  return {
    type: config.transportType,
    url: config.serverUrl,
    ...(config.headers ? { headers: config.headers } : {}),
  };
}

export async function loadMCPConfigs(channelId: string): Promise<MCPServerConfig[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(mcpConfigs)
    .where(or(isNull(mcpConfigs.channelId), eq(mcpConfigs.channelId, channelId)));

  return rows
    .filter((r) => r.enabled)
    .filter((r) => {
      const valid = mcpTransportTypeSchema.safeParse(r.transportType);
      if (!valid.success) {
        logger.warn('Skipping MCP config with invalid transportType', {
          serverName: r.serverName,
          transportType: r.transportType,
        });
      }
      return valid.success;
    })
    .map((r) => ({
      id: r.id,
      serverName: r.serverName,
      transportType: r.transportType as MCPTransportType,
      serverUrl: r.serverUrl,
      headers: (r.headers as Record<string, string>) ?? undefined,
      command: (r.command as string) ?? null,
      args: (r.args as string[]) ?? null,
      env: (r.env as Record<string, string>) ?? null,
      cwd: (r.cwd as string) ?? null,
      enabled: r.enabled,
      channelId: r.channelId,
    }));
}
