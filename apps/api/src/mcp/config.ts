import type { MCPTransport } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport as StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import { getLogger } from '@logtape/logtape';
import { eq, isNull, mcpConfigs, or } from '@personalclaw/db';
import type { MCPTransportType } from '@personalclaw/shared';
import {
  hasBlockedEnvKey,
  hasEvalFlag,
  hasPathTraversal,
  hasShellMetachars,
  isAllowedStdioCommand,
  MAX_STDIO_ARG_LENGTH,
  MAX_STDIO_ARGS_COUNT,
  MAX_STDIO_CWD_LENGTH,
  mcpTransportTypeSchema,
} from '@personalclaw/shared';
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

/**
 * Runtime validation for stdio MCP configs — defense-in-depth.
 * Even if a value reaches the DB without schema validation (e.g. direct
 * SQL insert), this layer blocks dangerous commands before spawn.
 *
 * Error messages are kept generic to avoid leaking security policy
 * details to API callers; specifics are logged server-side.
 */
function validateStdioConfig(config: MCPServerConfig): void {
  if (!config.command) {
    throw new Error(`MCP config "${config.serverName}" has stdio transport but no command`);
  }
  if (!isAllowedStdioCommand(config.command)) {
    logger.warn('Rejected disallowed stdio command', {
      serverName: config.serverName,
      command: config.command,
    });
    throw new Error(
      `MCP config "${config.serverName}": stdio configuration rejected by security policy`,
    );
  }
  if (config.args) {
    if (!Array.isArray(config.args) || !config.args.every((a) => typeof a === 'string')) {
      logger.warn('Rejected stdio args: invalid type from DB', {
        serverName: config.serverName,
      });
      throw new Error(
        `MCP config "${config.serverName}": stdio configuration rejected by security policy`,
      );
    }
    if (config.args.length > MAX_STDIO_ARGS_COUNT) {
      logger.warn('Rejected stdio args: too many', {
        serverName: config.serverName,
        count: config.args.length,
      });
      throw new Error(
        `MCP config "${config.serverName}": stdio configuration rejected by security policy`,
      );
    }
    if (config.args.some((a) => a.length > MAX_STDIO_ARG_LENGTH)) {
      logger.warn('Rejected stdio arg: exceeds max length', { serverName: config.serverName });
      throw new Error(
        `MCP config "${config.serverName}": stdio configuration rejected by security policy`,
      );
    }
    if (hasShellMetachars(config.args)) {
      logger.warn('Rejected stdio args: shell metacharacters', {
        serverName: config.serverName,
      });
      throw new Error(
        `MCP config "${config.serverName}": stdio configuration rejected by security policy`,
      );
    }
    if (hasEvalFlag(config.args)) {
      logger.warn('Rejected stdio args: eval/exec flag detected', {
        serverName: config.serverName,
      });
      throw new Error(
        `MCP config "${config.serverName}": stdio configuration rejected by security policy`,
      );
    }
  }
  if (config.env) {
    if (typeof config.env !== 'object' || Array.isArray(config.env)) {
      logger.warn('Rejected stdio env: invalid type from DB', {
        serverName: config.serverName,
      });
      throw new Error(
        `MCP config "${config.serverName}": stdio configuration rejected by security policy`,
      );
    }
    if (hasBlockedEnvKey(config.env)) {
      logger.warn('Rejected stdio env: blocked key detected', {
        serverName: config.serverName,
      });
      throw new Error(
        `MCP config "${config.serverName}": stdio configuration rejected by security policy`,
      );
    }
  }
  if (config.cwd) {
    if (typeof config.cwd !== 'string') {
      logger.warn('Rejected stdio cwd: invalid type from DB', {
        serverName: config.serverName,
      });
      throw new Error(
        `MCP config "${config.serverName}": stdio configuration rejected by security policy`,
      );
    }
    if (config.cwd.length > MAX_STDIO_CWD_LENGTH) {
      logger.warn('Rejected stdio cwd: exceeds max length', { serverName: config.serverName });
      throw new Error(
        `MCP config "${config.serverName}": stdio configuration rejected by security policy`,
      );
    }
    if (hasPathTraversal(config.cwd)) {
      logger.warn('Rejected stdio cwd: path traversal', {
        serverName: config.serverName,
        cwd: config.cwd,
      });
      throw new Error(
        `MCP config "${config.serverName}": stdio configuration rejected by security policy`,
      );
    }
  }
}

export function buildTransport(
  config: MCPServerConfig,
): { type: 'sse' | 'http'; url: string; headers?: Record<string, string> } | MCPTransport {
  if (config.transportType === 'stdio') {
    validateStdioConfig(config);
    const command = config.command;
    if (!command) {
      throw new Error(`MCP config "${config.serverName}" has stdio transport but no command`);
    }
    return new StdioMCPTransport({
      command,
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
