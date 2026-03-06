import { SandboxManager } from '../sandbox/manager';
import { ApprovalService } from './approval.service';
import { ChannelService } from './channel.service';
import { ConversationService } from './conversation.service';
import { IdentityService } from './identity.service';
import { MCPService } from './mcp.service';
import { MemoryService } from './memory.service';
import { ScheduleService } from './schedule.service';
import { SkillService } from './skill.service';
import { UsageService } from './usage.service';

class ServiceContainer {
  private cache = new Map<string, unknown>();

  private getOrCreate<T>(key: string, factory: () => T): T {
    if (!this.cache.has(key)) this.cache.set(key, factory());
    return this.cache.get(key) as T;
  }

  get channels() {
    return this.getOrCreate('channels', () => new ChannelService());
  }
  get skills() {
    return this.getOrCreate('skills', () => new SkillService());
  }
  get schedules() {
    return this.getOrCreate('schedules', () => new ScheduleService());
  }
  get mcp() {
    return this.getOrCreate('mcp', () => new MCPService());
  }
  get identity() {
    return this.getOrCreate('identity', () => new IdentityService());
  }
  get usage() {
    return this.getOrCreate('usage', () => new UsageService());
  }
  get memories() {
    return this.getOrCreate('memories', () => new MemoryService());
  }
  get approvals() {
    return this.getOrCreate('approvals', () => new ApprovalService());
  }
  get conversations() {
    return this.getOrCreate('conversations', () => new ConversationService());
  }
  get sandbox() {
    return this.getOrCreate('sandbox', () => new SandboxManager());
  }
}

export const services = new ServiceContainer();
