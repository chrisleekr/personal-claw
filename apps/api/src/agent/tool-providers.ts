import type { ToolSet } from 'ai';
import { getBrowserTools } from '../browser/tools';
import { getCLITools } from '../cli/tools';
import { getScheduleTools } from '../cron/tools';
import { getIdentityTools } from '../identity/tools';
import type { MCPManager } from '../mcp/manager';
import { getMemoryTools } from '../memory/tools';
import { getSubAgentTools } from './sub-agent-tools';
import type { ToolContext, ToolProvider } from './tool-registry';

export class MemoryToolProvider implements ToolProvider {
  readonly name = 'memory';

  async getTools(ctx: ToolContext): Promise<ToolSet> {
    return getMemoryTools(ctx.channelId, ctx.userId, ctx.threadId);
  }

  getSafeToolNames(): string[] {
    return ['memory_search', 'memory_list', 'memory_save'];
  }
}

export class IdentityToolProvider implements ToolProvider {
  readonly name = 'identity';

  async getTools(ctx: ToolContext): Promise<ToolSet> {
    return getIdentityTools(ctx.channelId, ctx.userId, ctx.threadId);
  }

  getSafeToolNames(): string[] {
    return ['identity_get', 'identity_set', 'team_context_set'];
  }
}

export class CLIToolProvider implements ToolProvider {
  readonly name = 'cli';

  async getTools(): Promise<ToolSet> {
    return getCLITools();
  }

  getSafeToolNames(): string[] {
    return ['aws_cli', 'github_cli', 'curl_fetch'];
  }
}

export class BrowserToolProvider implements ToolProvider {
  readonly name = 'browser';

  async getTools(): Promise<ToolSet> {
    return getBrowserTools();
  }

  getSafeToolNames(): string[] {
    return ['browser_scrape', 'browser_screenshot'];
  }
}

export class ScheduleToolProvider implements ToolProvider {
  readonly name = 'schedules';

  async getTools(ctx: ToolContext): Promise<ToolSet> {
    return getScheduleTools(ctx.channelId);
  }

  getSafeToolNames(): string[] {
    return ['schedule_list', 'schedule_create'];
  }
}

export class SubAgentToolProvider implements ToolProvider {
  readonly name = 'sub-agents';

  async getTools(ctx: ToolContext): Promise<ToolSet> {
    return getSubAgentTools(ctx.channelId);
  }

  getSafeToolNames(): string[] {
    return ['spawn_subtask', 'get_subtask_result'];
  }
}

export class MCPToolProvider implements ToolProvider {
  readonly name = 'mcp';

  constructor(private mcpManager: MCPManager) {}

  async getTools(ctx: ToolContext): Promise<ToolSet> {
    return this.mcpManager.getToolsForChannel(ctx.channelId);
  }
}
