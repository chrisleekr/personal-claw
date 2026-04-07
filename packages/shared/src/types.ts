export type KnownProvider = 'anthropic' | 'bedrock' | 'openai' | 'ollama';
export type LLMProvider = KnownProvider | (string & {});
export type PromptInjectMode = 'every-turn' | 'once' | 'minimal';
export type MemoryCategory =
  | 'fact'
  | 'preference'
  | 'decision'
  | 'person'
  | 'project'
  | 'procedure';
export type ApprovalPolicy = 'ask' | 'allowlist' | 'deny' | 'auto';
export type MCPTransportType = 'sse' | 'http' | 'stdio';
export type ChannelPlatform = 'slack' | 'discord' | 'teams' | 'cli';
export type ThreadReplyMode = 'all' | 'mentions_only' | 'original_poster';
export type AutonomyLevel = 'cautious' | 'balanced' | 'autonomous';

export interface ChannelConfig {
  id: string;
  platform: ChannelPlatform;
  externalId: string;
  externalName: string | null;
  identityPrompt: string | null;
  teamPrompt: string | null;
  model: string;
  provider: LLMProvider;
  maxIterations: number;
  guardrailsConfig: GuardrailsConfig | null;
  sandboxEnabled: boolean;
  sandboxConfig: SandboxConfig | null;
  heartbeatEnabled: boolean;
  heartbeatPrompt: string | null;
  heartbeatCron: string;
  memoryConfig: MemoryConfig;
  promptInjectMode: PromptInjectMode;
  providerFallback: ProviderFallbackEntry[];
  browserEnabled: boolean;
  costBudgetDailyUsd: number | null;
  threadReplyMode: ThreadReplyMode;
  autonomyLevel: AutonomyLevel;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryConfig {
  maxMemories: number;
  injectTopN: number;
  /** @deprecated Embedding model is now selected by EMBEDDING_PROVIDER env var */
  embeddingModel?: string;
}

export interface ProviderFallbackEntry {
  provider: LLMProvider;
  model: string;
}

export interface GuardrailsConfig {
  preProcessing: {
    contentFiltering: boolean;
    intentClassification: boolean;
    maxInputLength: number;
  };
  postProcessing: {
    piiRedaction: boolean;
    outputValidation: boolean;
  };
}

export interface Skill {
  id: string;
  channelId: string;
  name: string;
  content: string;
  allowedTools: string[];
  enabled: boolean;
  createdAt: Date;
}

export interface MCPConfig {
  id: string;
  channelId: string | null;
  serverName: string;
  transportType: MCPTransportType;
  serverUrl: string | null;
  headers: Record<string, string> | null;
  command: string | null;
  args: string[] | null;
  env: Record<string, string> | null;
  cwd: string | null;
  enabled: boolean;
  createdAt: Date;
}

export interface ToolPolicy {
  id: string;
  channelId: string | null;
  mcpConfigId: string;
  allowList: string[];
  denyList: string[];
  createdAt: Date;
}

export interface MCPToolInfo {
  name: string;
  description?: string;
}

export interface Schedule {
  id: string;
  channelId: string;
  name: string;
  cronExpression: string;
  prompt: string;
  enabled: boolean;
  notifyUsers: string[];
  lastRunAt: Date | null;
  createdAt: Date;
}

export interface UsageLog {
  id: string;
  channelId: string;
  externalUserId: string;
  externalThreadId: string | null;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  durationMs: number | null;
  createdAt: Date;
}

export interface ApprovalPolicyRecord {
  id: string;
  channelId: string;
  toolName: string;
  policy: ApprovalPolicy;
  allowedUsers: string[];
  createdAt: Date;
}

export interface WorkflowPattern {
  id: string;
  channelId: string;
  patternHash: string;
  toolSequence: string[];
  description: string | null;
  occurrenceCount: number;
  successCount: number;
  lastSeenAt: Date;
  generatedSkillId: string | null;
  createdAt: Date;
}

export interface ChannelMemory {
  id: string;
  channelId: string;
  content: string;
  category: MemoryCategory;
  sourceThreadId: string | null;
  recallCount: number;
  lastRecalledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Conversation {
  id: string;
  channelId: string;
  externalThreadId: string;
  messages: ConversationMessage[];
  summary: string | null;
  isCompacted: boolean;
  tokenCount: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationListItem {
  id: string;
  channelId: string;
  externalThreadId: string;
  firstMessage: string | null;
  messageCount: number;
  summary: string | null;
  isCompacted: boolean;
  tokenCount: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  externalUserId?: string;
  timestamp: string;
  toolCalls?: ToolCallRecord[];
}

export interface ToolCallRecord {
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  durationMs: number;
  requiresApproval: boolean;
  approved: boolean | null;
}

export type HookEventType =
  | 'message:received'
  | 'message:sending'
  | 'message:sent'
  | 'tool:called'
  | 'memory:saved'
  | 'identity:updated'
  | 'budget:warning'
  | 'budget:exceeded'
  | 'reaction:received';

export interface ThreadState {
  messages: ConversationMessage[];
  channelId: string;
  threadId: string;
  lastActivityAt: string;
}

export interface HookContext {
  channelId: string;
  externalUserId: string;
  threadId: string;
  eventType: HookEventType;
  payload: Record<string, unknown>;
  cancel?: () => void;
  modify?: (data: Record<string, unknown>) => void;
}

export interface SkillUsage {
  id: string;
  skillId: string;
  channelId: string;
  externalUserId: string;
  wasHelpful: boolean | null;
  createdAt: Date;
}

export interface SkillStats {
  skillId: string;
  usageCount: number;
}

export interface SkillDraft {
  name: string;
  content: string;
}

export interface BudgetStatus {
  dailyBudget: number | null;
  todaySpend: number;
  percentUsed: number | null;
}

export interface SandboxConfig {
  allowedCommands: string[];
  deniedPatterns: string[];
  maxExecutionTimeS: number;
  maxWorkspaceSizeMb: number;
  networkAccess: boolean;
  gitTokenEnvVar: string | null;
}

export interface CLIToolDefinition {
  name: string;
  binary: string;
  description: string;
  allowedPatterns: readonly RegExp[];
  deniedPatterns: readonly RegExp[];
  timeoutMs: number;
  env?: Record<string, string>;
}

export interface CLIExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ImageAttachment {
  data: Buffer;
  mimetype: string;
}

/** Tracks which tools were approved in a plan and when approval expires. */
export interface PlanApprovalState {
  /** Tool names explicitly declared in the approved plan. */
  approvedToolNames: Set<string>;
  /** Unix timestamp (ms) when the plan was approved. */
  approvedAt: number;
  /** Per-channel timeout in ms after which approval expires. */
  timeoutMs: number;
}
