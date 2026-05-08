import { getLogger } from '@logtape/logtape';
import { ChannelResolver } from '../channels/resolver';
import { onConfigChange } from '../config/hot-reload';
import { MCPManager } from '../mcp/manager';
import { MemoryEngine } from '../memory/engine';
import { SandboxManager } from '../sandbox/manager';
import { CostTracker } from './cost-tracker';
import { createDetectionEngine } from './detection/engine';
import { GuardrailsEngine } from './guardrails';
import type { AgentRunParams, AgentRunResult, PipelineContext, PipelineStage } from './pipeline';
import {
  assembleContextStage,
  composePromptStage,
  createSandboxStage,
  generateStage,
  loadToolsStage,
  persistStage,
  postProcessStage,
  preProcessStage,
  trackSkillUsageStage,
  wrapApprovalStage,
} from './pipeline';
import { PromptComposer } from './prompt-composer';
import {
  BrowserToolProvider,
  CLIToolProvider,
  IdentityToolProvider,
  MCPToolProvider,
  MemoryToolProvider,
  ScheduleToolProvider,
  SubAgentToolProvider,
} from './tool-providers';
import { ToolRegistry } from './tool-registry';

export type { AgentRunParams, AgentRunResult } from './pipeline';

const logger = getLogger(['personalclaw', 'agent', 'engine']);

export interface AgentDeps {
  guardrails: GuardrailsEngine;
  promptComposer: PromptComposer;
  memoryEngine: MemoryEngine;
  toolRegistry: ToolRegistry;
  sandboxManager: SandboxManager;
  mcpManager: MCPManager;
}

async function createDefaultDeps(): Promise<AgentDeps> {
  const mcpManager = new MCPManager();
  const toolRegistry = new ToolRegistry();
  const sandboxManager = new SandboxManager();

  await sandboxManager.initialize();

  toolRegistry.register(new MemoryToolProvider());
  toolRegistry.register(new IdentityToolProvider());
  toolRegistry.register(new CLIToolProvider());
  toolRegistry.register(new BrowserToolProvider());
  toolRegistry.register(new ScheduleToolProvider());
  toolRegistry.register(new SubAgentToolProvider());
  toolRegistry.register(new MCPToolProvider(mcpManager));

  onConfigChange((channelId, changeType) => {
    ChannelResolver.getInstance().invalidate(channelId);
    if (changeType !== 'mcp') return;
    if (channelId === '__global__') {
      mcpManager.invalidateAll();
    } else {
      mcpManager.invalidateChannel(channelId);
    }
  });

  const costTracker = new CostTracker();
  const memoryEngine = new MemoryEngine();
  // FR-025: inject a detection engine into the memory engine so recalled
  // memories are routed through the pipeline before being added to the
  // system prompt. The engine uses the same cost tracker as guardrails.
  memoryEngine.setDetectionEngine(createDetectionEngine(costTracker));
  return {
    guardrails: new GuardrailsEngine(costTracker),
    promptComposer: new PromptComposer(),
    memoryEngine,
    toolRegistry,
    sandboxManager,
    mcpManager,
  };
}

let defaultDeps: AgentDeps | null = null;
let defaultDepsPromise: Promise<AgentDeps> | null = null;

async function getDefaultDeps(): Promise<AgentDeps> {
  if (defaultDeps) return defaultDeps;
  if (!defaultDepsPromise) {
    defaultDepsPromise = createDefaultDeps().then((deps) => {
      defaultDeps = deps;
      return deps;
    });
  }
  return defaultDepsPromise;
}

export async function shutdownEngine(): Promise<void> {
  if (!defaultDeps) return;
  await defaultDeps.mcpManager.closeAll();
  await defaultDeps.sandboxManager.destroyAll();
  defaultDeps.sandboxManager.shutdown();
  defaultDeps = null;
  defaultDepsPromise = null;
}

export class AgentEngine {
  private stages: PipelineStage[];
  private memoryEngine: MemoryEngine;
  private sandboxManager: SandboxManager;

  private constructor(deps: AgentDeps) {
    this.memoryEngine = deps.memoryEngine;
    this.sandboxManager = deps.sandboxManager;
    this.stages = [
      preProcessStage(deps.guardrails, deps.memoryEngine),
      assembleContextStage(deps.memoryEngine),
      loadToolsStage(deps.toolRegistry),
      createSandboxStage(deps.sandboxManager),
      wrapApprovalStage(deps.guardrails.getDetectionEngine()),
      composePromptStage(deps.promptComposer, deps.guardrails),
      generateStage,
      postProcessStage(deps.guardrails),
      persistStage(deps.memoryEngine),
      trackSkillUsageStage,
    ];
  }

  static async create(deps?: AgentDeps): Promise<AgentEngine> {
    const d = deps ?? (await getDefaultDeps());
    return new AgentEngine(d);
  }

  async run(params: AgentRunParams): Promise<AgentRunResult> {
    const start = Date.now();

    let ctx: PipelineContext = {
      params,
      input: params.text,
      memories: [],
      messages: [],
      tools: {},
      safeToolNames: new Set(),
      systemPrompt: '',
      loadedSkillIds: [],
      providerName: '',
      model: '',
      result: null,
      toolCallRecords: [],
      response: '',
      startTime: start,
    };

    try {
      for (const stage of this.stages) {
        ctx = await stage(ctx);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'ApprovalDismissedError') {
        const dismissedPlan = ctx.getDismissedPlan?.();

        logger.debug('Approval dismissed, persisting context for continuity', {
          channelId: params.channelId,
          threadId: params.threadId,
          hasDismissedPlan: !!dismissedPlan,
        });

        const userMsg = {
          role: 'user' as const,
          content: params.text,
          externalUserId: params.userId,
          timestamp: new Date().toISOString(),
        };

        if (dismissedPlan) {
          await this.memoryEngine.persistConversation(params.channelId, params.threadId, userMsg, {
            role: 'assistant' as const,
            content: '',
            timestamp: new Date().toISOString(),
            toolCalls: [
              {
                toolName: 'confirm_plan',
                args: { summary: dismissedPlan.summary, steps: dismissedPlan.steps },
                result: {
                  dismissed: true,
                  message:
                    'Plan was superseded by a follow-up message. Revise the plan to address the new request.',
                },
                durationMs: 0,
                requiresApproval: false,
                approved: null,
              },
            ],
          });
        } else {
          await this.memoryEngine.persistUserMessage(params.channelId, params.threadId, userMsg);
        }
      }

      if (error instanceof Error && error.name === 'PlanRejectedError') {
        const rejectedPlan = ctx.getDismissedPlan?.();

        logger.debug('Plan rejected, persisting context for continuity', {
          channelId: params.channelId,
          threadId: params.threadId,
          hasRejectedPlan: !!rejectedPlan,
        });

        const userMsg = {
          role: 'user' as const,
          content: params.text,
          externalUserId: params.userId,
          timestamp: new Date().toISOString(),
        };

        if (rejectedPlan) {
          await this.memoryEngine.persistConversation(params.channelId, params.threadId, userMsg, {
            role: 'assistant' as const,
            content: '',
            timestamp: new Date().toISOString(),
            toolCalls: [
              {
                toolName: 'confirm_plan',
                args: { summary: rejectedPlan.summary, steps: rejectedPlan.steps },
                result: {
                  rejected: true,
                  message: 'Plan was rejected or timed out by the user.',
                },
                durationMs: 0,
                requiresApproval: false,
                approved: false,
              },
            ],
          });
        } else {
          await this.memoryEngine.persistUserMessage(params.channelId, params.threadId, userMsg);
        }

        return {
          text: "Got it — I won't proceed with that plan. Let me know what you'd like to change or try instead.",
          provider: ctx.providerName || 'none',
          model: ctx.model || 'none',
          usage: { inputTokens: 0, outputTokens: 0 },
          durationMs: Date.now() - start,
          toolSequence: ['confirm_plan'],
          skillIds: ctx.loadedSkillIds,
        };
      }

      throw error;
    } finally {
      if (ctx.sandbox) {
        await this.sandboxManager.destroy(params.channelId, params.threadId).catch((err) => {
          logger.warn('Failed to cleanup sandbox after pipeline run', {
            channelId: params.channelId,
            threadId: params.threadId,
            error: (err as Error).message,
          });
        });
      }
    }

    logger.debug('Pipeline completed', {
      channelId: params.channelId,
      threadId: params.threadId,
      provider: ctx.providerName,
      model: ctx.model,
      durationMs: Date.now() - start,
      toolCallCount: ctx.toolCallRecords.length,
    });

    return {
      text: ctx.response,
      provider: ctx.providerName,
      model: ctx.model,
      usage: {
        inputTokens: ctx.result?.usage?.inputTokens ?? 0,
        outputTokens: ctx.result?.usage?.outputTokens ?? 0,
      },
      durationMs: Date.now() - start,
      toolSequence: ctx.toolCallRecords.map((tc) => tc.toolName),
      skillIds: ctx.loadedSkillIds,
    };
  }
}
