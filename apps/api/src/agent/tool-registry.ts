import { getLogger } from '@logtape/logtape';
import type { ToolSet } from 'ai';
import { errorDetails } from '../utils/error-fmt';

const logger = getLogger(['personalclaw', 'agent', 'tools']);

export interface ToolContext {
  channelId: string;
  userId: string;
  threadId: string;
}

export interface ToolProvider {
  readonly name: string;
  getTools(context: ToolContext): Promise<ToolSet>;
  getSafeToolNames?(): string[];
}

export class ToolRegistry {
  private providers: ToolProvider[] = [];

  register(provider: ToolProvider): void {
    this.providers.push(provider);
    logger.debug`Registered tool provider: ${provider.name}`;
  }

  async loadAll(context: ToolContext): Promise<ToolSet> {
    const tools: ToolSet = {};
    for (const provider of this.providers) {
      try {
        const provided = await provider.getTools(context);
        Object.assign(tools, provided);
      } catch (error) {
        logger.error('Tool provider failed to load', {
          provider: provider.name,
          channelId: context.channelId,
          ...errorDetails(error),
        });
      }
    }
    return tools;
  }

  getSafeToolNames(): Set<string> {
    const safe = new Set<string>();
    for (const provider of this.providers) {
      for (const name of provider.getSafeToolNames?.() ?? []) {
        safe.add(name);
      }
    }
    return safe;
  }
}
