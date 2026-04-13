import { getLogger } from '@logtape/logtape';
import { channels, eq, skillUsages } from '@personalclaw/db';
import type {
  ChannelMemory,
  ConversationMessage,
  ImageAttachment,
  SandboxConfig,
  ToolCallRecord,
} from '@personalclaw/shared';
import type { ModelMessage, ToolSet } from 'ai';
import { generateText, stepCountIs } from 'ai';
import type { ChannelAdapter } from '../channels/adapter';
import { getDb } from '../db';
import type { MemoryEngine } from '../memory/engine';
import type { SandboxManager } from '../sandbox/manager';
import { DEFAULT_SANDBOX_CONFIG } from '../sandbox/manager';
import { getSandboxTools } from '../sandbox/tools';
import type { Sandbox } from '../sandbox/types';
import { errorDetails } from '../utils/error-fmt';
import { ApprovalGateway, type DismissedPlan } from './approval-gateway';
import type { DetectionEngine } from './detection/engine';
import type { CanaryToken } from './detection/types';
import type { GuardrailsEngine } from './guardrails';
import type { PromptComposer } from './prompt-composer';
import { getProviderWithFallback, resolveProviderEntry } from './provider';
import type { ToolRegistry } from './tool-registry';

const logger = getLogger(['personalclaw', 'agent', 'pipeline']);

export interface AgentRunParams {
  channelId: string;
  threadId: string;
  userId: string;
  text: string;
  images?: ImageAttachment[];
  adapter: ChannelAdapter;
}

export interface AgentRunResult {
  text: string;
  provider: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  durationMs: number;
  toolSequence: string[];
  skillIds: string[];
}

export interface PipelineContext {
  params: AgentRunParams;
  input: string;
  memories: ChannelMemory[];
  messages: ModelMessage[];
  tools: ToolSet;
  safeToolNames: Set<string>;
  systemPrompt: string;
  loadedSkillIds: string[];
  providerName: string;
  model: string;
  result: Awaited<ReturnType<typeof generateText<ToolSet>>> | null;
  toolCallRecords: ToolCallRecord[];
  response: string;
  startTime: number;
  toolTimings?: Map<string, number>;
  getDismissedPlan?: () => DismissedPlan | null;
  sandbox?: Sandbox;
  /**
   * Per-request canary token attached in `composePromptStage` and consumed
   * in `postProcessStage` per FR-020. Null when the channel has
   * canaryTokenEnabled set to false.
   */
  canary?: CanaryToken | null;
  /**
   * True when preProcessStage flagged the input as suspicious but did not
   * block it (FR-005). Downstream approval checks MUST NOT auto-execute
   * tools when this is true.
   */
  detectionFlagged?: boolean;
  /**
   * Structured block notice surfaced when preProcessStage caught a
   * DetectionBlockedError. Set to a non-empty string on block; the
   * generate stage checks this and skips the LLM call.
   */
  detectionBlockResponse?: string;
}

export type PipelineStage = (ctx: PipelineContext) => Promise<PipelineContext>;

/**
 * Extracts the last N `role: 'user'` conversation messages from stored
 * history. Used by `preProcessStage` to feed the FR-012 multi-turn window
 * into the detection engine.
 *
 * N is hardcoded to 10 per FR-012. Changing it requires a PR review.
 */
function extractRecentUserHistory(history: readonly ConversationMessage[], n = 10): string[] {
  const userMessages: string[] = [];
  for (let i = history.length - 1; i >= 0 && userMessages.length < n; i--) {
    const m = history[i];
    if (m.role === 'user' && m.content) {
      userMessages.push(m.content);
    }
  }
  return userMessages.reverse();
}

/**
 * Runs the input-side detection pipeline over the incoming message. Loads
 * the FR-012 multi-turn history window via `memoryEngine.assembleContext()`
 * directly so it does not depend on `ctx.messages` having been built yet.
 * On `DetectionBlockedError`, populates `ctx.detectionBlockResponse` with
 * a user-facing notice per FR-004.
 */
export function preProcessStage(
  guardrails: GuardrailsEngine,
  memoryEngine: MemoryEngine,
): PipelineStage {
  return async (ctx) => {
    // Load recent user history independently of assembleContextStage so the
    // FR-012 window is available for detection before the full context is
    // built. This is a lightweight call — memoryEngine caches aggressively.
    let recentHistory: string[] = [];
    try {
      const assembled = await memoryEngine.assembleContext(
        ctx.params.channelId,
        ctx.params.threadId,
      );
      recentHistory = extractRecentUserHistory(assembled.messages);
    } catch (error) {
      logger.warn('Failed to load history for detection window; proceeding with empty window', {
        channelId: ctx.params.channelId,
        error: (error as Error).message,
      });
    }

    try {
      const validated = await guardrails.preProcess({
        channelId: ctx.params.channelId,
        text: ctx.params.text,
        externalUserId: ctx.params.userId,
        threadId: ctx.params.threadId,
        recentHistory,
      });
      return { ...ctx, input: validated.text, detectionFlagged: validated.flagged };
    } catch (error) {
      const { DetectionBlockedError } = await import('./guardrails');
      if (error instanceof DetectionBlockedError) {
        logger.info('Detection pipeline blocked input', {
          channelId: ctx.params.channelId,
          threadId: ctx.params.threadId,
          referenceId: error.decision.referenceId,
          reasonCode: error.decision.reasonCode,
          layersFired: error.decision.layersFired,
        });
        return {
          ...ctx,
          detectionBlockResponse:
            `⚠️ Your message was rejected as a suspected prompt injection attempt.\n` +
            `Reference: ${error.decision.referenceId}\n` +
            `Reason: ${error.decision.reasonCode}\n` +
            `Share this reference with a channel admin to request review.`,
        };
      }
      throw error;
    }
  };
}

function toAIMessages(history: ConversationMessage[]): ModelMessage[] {
  const messages: ModelMessage[] = [];

  for (let i = 0; i < history.length; i++) {
    const m = history[i];

    if (m.role === 'user' || m.role === 'system') {
      messages.push({ role: m.role, content: m.content });
      continue;
    }

    if (!m.toolCalls || m.toolCalls.length === 0) {
      messages.push({ role: 'assistant', content: m.content });
      continue;
    }

    const parts: Array<
      | { type: 'text'; text: string }
      | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
    > = [];
    if (m.content) {
      parts.push({ type: 'text', text: m.content });
    }

    const toolResults: Array<{
      type: 'tool-result';
      toolCallId: string;
      toolName: string;
      output: { type: 'text'; value: string };
    }> = [];

    for (let j = 0; j < m.toolCalls.length; j++) {
      const tc = m.toolCalls[j];
      const toolCallId = `tc_${i}_${j}`;
      parts.push({ type: 'tool-call', toolCallId, toolName: tc.toolName, input: tc.args });
      toolResults.push({
        type: 'tool-result',
        toolCallId,
        toolName: tc.toolName,
        output: { type: 'text', value: JSON.stringify(tc.result ?? '') },
      });
    }

    messages.push({ role: 'assistant', content: parts });
    messages.push({ role: 'tool', content: toolResults });
  }

  return messages;
}

export function assembleContextStage(memoryEngine: MemoryEngine): PipelineStage {
  return async (ctx) => {
    const context = await memoryEngine.assembleContext(ctx.params.channelId, ctx.params.threadId);
    const historyMessages = toAIMessages(context.messages);

    const images = ctx.params.images;
    const userMessage: ModelMessage =
      images && images.length > 0
        ? {
            role: 'user',
            content: [
              { type: 'text', text: ctx.input },
              ...images.map((img) => ({
                type: 'image' as const,
                image: img.data,
                mimeType: img.mimetype,
              })),
            ],
          }
        : { role: 'user', content: ctx.input };

    return {
      ...ctx,
      memories: context.memories,
      messages: [...historyMessages, userMessage],
    };
  };
}

export function loadToolsStage(toolRegistry: ToolRegistry): PipelineStage {
  return async (ctx) => {
    const tools = await toolRegistry.loadAll({
      channelId: ctx.params.channelId,
      userId: ctx.params.userId,
      threadId: ctx.params.threadId,
    });
    const safeToolNames = toolRegistry.getSafeToolNames();
    return { ...ctx, tools, safeToolNames };
  };
}

/**
 * Factory for the wrap-approval stage. Takes a `DetectionEngine` so the
 * gateway can filter untrusted tool outputs per FR-006 / FR-030.
 */
export function wrapApprovalStage(detectionEngine: DetectionEngine): PipelineStage {
  return async (ctx) => {
    // verifiedUserId=true: all current invocations come through platform adapters
    // (Slack Bolt) which verify request signatures before events reach handlers.
    // detectionFlagged forwards the FR-005 invariant: when the detection
    // pipeline flagged the turn, no tool auto-executes regardless of policy.
    // The detection engine is injected so the gateway can route Category 3/4
    // tool outputs through detection per FR-006.
    const gateway = new ApprovalGateway(
      ctx.params.channelId,
      ctx.params.threadId,
      ctx.params.userId,
      ctx.params.adapter,
      ctx.safeToolNames,
      true,
      ctx.detectionFlagged ?? false,
      detectionEngine,
    );

    // Tools with "auto" approval policy should be treated as safe/autonomous
    // so the system prompt doesn't force the model through confirm_plan.
    const autoApproved = await gateway.getAutoApprovedNames(Object.keys(ctx.tools));
    const mergedSafeNames = new Set([...ctx.safeToolNames, ...autoApproved]);

    const wrappedTools = gateway.wrapTools(ctx.tools);
    const confirmPlanTool = gateway.getConfirmPlanTool();
    return {
      ...ctx,
      safeToolNames: mergedSafeNames,
      tools: { confirm_plan: confirmPlanTool, ...wrappedTools },
      toolTimings: gateway.toolTimings,
      getDismissedPlan: () => gateway.lastPlan,
    };
  };
}

/**
 * Composes the system prompt and injects the per-request canary token
 * (FR-020) at the END of the prompt inside a DO_NOT_ECHO marker block.
 *
 * Short-circuits the composition entirely when a prior stage set
 * `detectionBlockResponse` — in that case there is no LLM call and the
 * system prompt is not needed.
 */
export function composePromptStage(
  promptComposer: PromptComposer,
  guardrails: GuardrailsEngine,
): PipelineStage {
  return async (ctx) => {
    // Skip prompt composition entirely when detection already blocked the input.
    if (ctx.detectionBlockResponse) {
      return ctx;
    }
    const { systemPrompt, loadedSkillIds } = await promptComposer.compose(
      ctx.params.channelId,
      ctx.memories,
      Object.keys(ctx.tools),
      ctx.safeToolNames,
    );
    const canary = await guardrails.generateCanaryForChannel(ctx.params.channelId);
    const finalPrompt = guardrails.injectCanaryIntoPrompt(systemPrompt, canary);
    return { ...ctx, systemPrompt: finalPrompt, loadedSkillIds, canary };
  };
}

const RESULT_PREVIEW_MAX_LEN = 120;

function summarizeOutput(output: unknown): string {
  if (!output || typeof output !== 'object') return '';
  const raw = JSON.stringify(output);
  if (raw.length <= RESULT_PREVIEW_MAX_LEN) return ` — ${raw}`;
  return ` — ${raw.slice(0, RESULT_PREVIEW_MAX_LEN)}…`;
}

function composeFallbackResponse(
  result: Awaited<ReturnType<typeof generateText<ToolSet>>>,
): string {
  const summaries: string[] = [];

  for (const step of result.steps ?? []) {
    for (let i = 0; i < (step.toolCalls?.length ?? 0); i++) {
      const call = step.toolCalls?.[i];
      const output = step.toolResults?.[i]?.output as Record<string, unknown> | undefined;

      if (output?.error) {
        const msg = typeof output.message === 'string' ? `: ${output.message}` : '';
        summaries.push(`Tried \`${call.toolName}\` but it was denied${msg}`);
      } else {
        summaries.push(`Used \`${call.toolName}\`${summarizeOutput(output)}`);
      }
    }
  }

  if (summaries.length === 0) {
    return "I wasn't able to generate a response. Could you rephrase or provide more detail?";
  }

  return [
    "Here's what I did:",
    ...summaries.map((s) => `• ${s}`),
    '',
    'Let me know if you need anything else.',
  ].join('\n');
}

function isRetryableError(error: unknown): boolean {
  const msg = (error as Error).message ?? '';
  const status = (error as { status?: number }).status;
  return (
    status === 429 ||
    msg.includes('rate limit') ||
    msg.includes('timeout') ||
    msg.includes('ETIMEDOUT')
  );
}

function shouldTryNextFallback(error: unknown): boolean {
  if (isRetryableError(error)) return true;
  const statusCode = (error as { statusCode?: number }).statusCode;
  return statusCode === 401 || statusCode === 403;
}

export const generateStage: PipelineStage = async (ctx) => {
  // If detection already blocked the input, skip the LLM call entirely and
  // propagate the block notice as the final response.
  if (ctx.detectionBlockResponse) {
    return {
      ...ctx,
      response: ctx.detectionBlockResponse,
      toolCallRecords: [],
      providerName: 'none',
      model: 'none',
    };
  }

  const { provider, model, providerName, fallbackChain } = await getProviderWithFallback(
    ctx.params.channelId,
  );

  const providerEntries = [
    { provider, model, providerName },
    ...fallbackChain
      .filter((f) => !(f.provider === providerName && f.model === model))
      .map((f) => {
        const resolved = resolveProviderEntry(f.provider, f.model);
        return { ...resolved, providerName: f.provider };
      }),
  ];

  let usedProviderName = providerName;
  let usedModel = model;
  let lastError: unknown;
  let result: Awaited<ReturnType<typeof generateText<ToolSet>>> | null = null;

  logger.debug('Engine run starting', {
    channelId: ctx.params.channelId,
    threadId: ctx.params.threadId,
    userId: ctx.params.userId,
    historyMessageCount: ctx.messages.length - 1,
    memoryCount: ctx.memories.length,
    toolCount: Object.keys(ctx.tools).length,
    toolNames: Object.keys(ctx.tools),
  });

  for (let i = 0; i < providerEntries.length; i++) {
    const p = providerEntries[i];
    try {
      result = await generateText({
        model: p.provider(p.model),
        system: ctx.systemPrompt,
        messages: ctx.messages,
        tools: ctx.tools,
        stopWhen: stepCountIs(15),
      });
      usedProviderName = p.providerName;
      usedModel = p.model;
      break;
    } catch (error) {
      lastError = error;
      if (shouldTryNextFallback(error) && i < providerEntries.length - 1) {
        logger.warn('Provider failed, trying next fallback', {
          provider: p.providerName,
          model: p.model,
          fallbackIndex: i,
          ...errorDetails(error),
        });
        continue;
      }
      throw error;
    }
  }

  if (!result) {
    throw lastError ?? new Error('All providers failed');
  }

  const toolCallRecords: ToolCallRecord[] = [];
  if (result.steps) {
    for (const step of result.steps) {
      const calls = step.toolCalls ?? [];
      const results = step.toolResults ?? [];
      for (let tc = 0; tc < calls.length; tc++) {
        const call = calls[tc];
        const toolResult = results[tc];
        toolCallRecords.push({
          toolName: call.toolName,
          args: ('args' in call ? call.args : {}) as Record<string, unknown>,
          result: toolResult?.output ?? null,
          durationMs: ctx.toolTimings?.get(call.toolCallId) ?? 0,
          requiresApproval: false,
          approved: null,
        });
      }
    }
  }

  logger.debug('AI response received', {
    channelId: ctx.params.channelId,
    threadId: ctx.params.threadId,
    provider: usedProviderName,
    model: usedModel,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
    toolCallCount: toolCallRecords.length,
  });

  return {
    ...ctx,
    result,
    providerName: usedProviderName,
    model: usedModel,
    toolCallRecords,
    response: result.text || composeFallbackResponse(result),
  };
};

/**
 * Runs PII redaction and the output-side canary check (FR-020) over the
 * final response. When detection already blocked the input at
 * `preProcessStage`, this stage still runs so the block notice goes
 * through PII redaction for consistency, but the canary check is a no-op
 * because `ctx.canary` is null on the block path.
 */
export function postProcessStage(guardrails: GuardrailsEngine): PipelineStage {
  return async (ctx) => {
    const sanitized = await guardrails.postProcess(
      ctx.response,
      ctx.params.channelId,
      ctx.canary ?? null,
      {
        externalUserId: ctx.params.userId,
        threadId: ctx.params.threadId,
      },
    );
    return { ...ctx, response: sanitized };
  };
}

export function persistStage(memoryEngine: MemoryEngine): PipelineStage {
  return async (ctx) => {
    const images = ctx.params.images;
    const imageMarkers =
      images && images.length > 0
        ? `\n${images.map((img) => `[Image attached: ${img.mimetype}]`).join('\n')}`
        : '';

    await memoryEngine.persistConversation(
      ctx.params.channelId,
      ctx.params.threadId,
      {
        role: 'user',
        content: ctx.params.text + imageMarkers,
        externalUserId: ctx.params.userId,
        timestamp: new Date().toISOString(),
      },
      {
        role: 'assistant',
        content: ctx.response,
        timestamp: new Date().toISOString(),
        toolCalls: ctx.toolCallRecords.length > 0 ? ctx.toolCallRecords : undefined,
      },
    );
    return ctx;
  };
}

export const trackSkillUsageStage: PipelineStage = async (ctx) => {
  if (ctx.loadedSkillIds.length > 0) {
    try {
      const db = getDb();
      await db.insert(skillUsages).values(
        ctx.loadedSkillIds.map((skillId) => ({
          skillId,
          channelId: ctx.params.channelId,
          externalUserId: ctx.params.userId,
        })),
      );
    } catch (error) {
      logger.warn('Failed to log skill usage', { ...errorDetails(error) });
    }
  }
  return ctx;
};

export function createSandboxStage(sandboxManager: SandboxManager): PipelineStage {
  return async (ctx) => {
    const db = getDb();
    const [row] = await db
      .select({
        sandboxEnabled: channels.sandboxEnabled,
        sandboxConfig: channels.sandboxConfig,
      })
      .from(channels)
      .where(eq(channels.id, ctx.params.channelId));

    if (!row?.sandboxEnabled) return ctx;

    const config = (row.sandboxConfig as SandboxConfig | null) ?? DEFAULT_SANDBOX_CONFIG;

    const sandbox = await sandboxManager.getOrCreate(
      ctx.params.channelId,
      ctx.params.threadId,
      config,
    );

    const sandboxTools = getSandboxTools(sandbox);

    return {
      ...ctx,
      sandbox,
      tools: { ...ctx.tools, ...sandboxTools },
      safeToolNames: new Set([
        ...ctx.safeToolNames,
        'sandbox_exec',
        'sandbox_write_file',
        'sandbox_read_file',
        'sandbox_list_files',
        'sandbox_workspace_info',
      ]),
    };
  };
}
