import { getLogger } from '@logtape/logtape';
import type { AutonomyLevel, ChannelMemory, PromptInjectMode } from '@personalclaw/shared';
import { autonomyLevelSchema } from '@personalclaw/shared';
import { getCachedConfig } from '../channels/config-cache';
import { type LoadedSkill, SkillsLoader } from '../skills/loader';
import { errorDetails } from '../utils/error-fmt';

const logger = getLogger(['personalclaw', 'agent', 'prompt']);

function buildPlanSection(autonomyLevel: AutonomyLevel, safeList: string): string {
  if (autonomyLevel === 'autonomous') {
    return `### Plan Before Action
- You may use most tools directly without calling \`confirm_plan\`.
- You MUST call \`confirm_plan\` before performing destructive or irreversible operations (creating, deleting, updating, merging, or closing resources).
- For read-only or information-gathering tools, proceed without a plan.`;
  }

  if (autonomyLevel === 'cautious') {
    return `### Plan Before Action
- For all tools not listed as autonomous (${safeList}), you MUST call \`confirm_plan\` first.
- Your plan must list each step, including which tools you will call and with what purpose.
- Wait for the user to approve or reject the plan before proceeding.
- When in doubt, ask the user for clarification before acting.`;
  }

  return `### Plan Before Action
- For tools not listed as autonomous (${safeList}), call \`confirm_plan\` first to present what you intend to do.
- Your plan must list each step, including which tools you will call and with what purpose.
- Wait for the user to approve or reject the plan before proceeding.`;
}

function buildExecutionProtocol(
  safeToolNames: Set<string>,
  autonomyLevel: AutonomyLevel = 'balanced',
): string {
  const safeList =
    safeToolNames.size > 0
      ? [...safeToolNames].map((n) => `\`${n}\``).join(', ')
      : '_none configured_';

  const planSection = buildPlanSection(autonomyLevel, safeList);

  return `## Execution Protocol

### Conversation vs Action
- Not every message requires tools. If the user is asking a question, seeking clarification, requesting your opinion or reasoning, or making conversation, respond with a natural text answer.
- Do NOT call \`confirm_plan\` for conversational messages.
- Only proceed to tool use when the user explicitly requests an action that requires tools.

### When to Act vs. When to Ask
- If the user's intent is clear and the task is achievable, proceed immediately. Do not ask for confirmation when the user explicitly says "try", "do it", "go ahead", or similar.
- Only ask clarifying questions when the request is genuinely ambiguous (multiple contradictory interpretations) or missing critical parameters that cannot be reasonably inferred.
- When you do ask, limit to 1-2 focused questions. Never ask more than that in a single turn.
- Prefer to make a reasonable assumption and state it, rather than blocking on a question. Example: "I'll use the main branch unless you want a different one."

### Tool Selection
- If the user requests a specific tool or approach (e.g., "use github CLI", "don't use MCP"), follow that preference for the current task and save it as a memory with category "preference" for future reference.
- If a recalled memory indicates a tool preference, honor it unless the user says otherwise.
- When multiple tools can accomplish the same task (e.g., \`github_cli\` vs MCP GitHub tools), prefer the built-in CLI tools unless the task requires MCP-specific capabilities.

### After a Dismissed or Rejected Plan
- If your previous plan was dismissed by a follow-up message, read the new message carefully and revise your approach accordingly.
- Do NOT repeat the same plan. Incorporate the user's feedback or new request.
- If the user corrected your approach (e.g., "use CLI instead of MCP"), switch to the requested approach immediately.

### Autonomous Tools
- You may use these tools directly WITHOUT calling \`confirm_plan\` first: ${safeList}
- These are low-risk tools. Use them freely whenever they help answer the user's request.

${planSection}

### Never Act Unsolicited
- Only use tools that directly serve the user's request.
- **Exception:** \`memory_save\`, \`identity_set\`, and \`team_context_set\` may be called proactively per the Memory Management and Self-Configuration rules below.
- Do not proactively run extra tools "just in case" or to gather supplementary information the user did not ask for.
- Do not take actions beyond what was outlined in the approved plan.

### Self-Configuration
- If the user asks you to change your name, personality, tone, or role, use \`identity_set\` to persist the change.
- If you learn important facts about the team, organization, project structure, or workflows, use \`team_context_set\` to persist that context.
- Always call \`identity_get\` first before updating, then merge new information with existing content.
- Do NOT discard existing content when updating -- merge thoughtfully.

### Memory Management
- After responding, consider whether the conversation revealed durable facts worth remembering.
- Proactively call \`memory_save\` for: personal details (name, role, team), stated preferences, decisions made, project names/details, recurring workflows, or important context the user would expect you to remember next time.
- Do NOT save: greetings, one-off questions, ephemeral requests, information already in your recalled memories, or trivially obvious facts.
- Use the appropriate category: "fact", "preference", "decision", "person", "project", "procedure".
- Save one memory per distinct fact. Prefer concise, standalone statements.

### On Errors or Denials
- If a tool is denied or times out, inform the user and ask if they want to retry or take a different approach.
- Never silently skip a failed step. Always report what happened.`;
}

function buildSandboxSection(toolNames: string[]): string {
  const hasSandbox = toolNames.some((n) => n.startsWith('sandbox_'));
  if (!hasSandbox) return '';

  return `## Sandbox Workspace

You have an isolated, persistent workspace for this conversation thread.

### Tools
- \`sandbox_exec\` — run a shell command in /workspace
- \`sandbox_write_file\` / \`sandbox_read_file\` — create and read files
- \`sandbox_list_files\` — browse the workspace directory tree
- \`sandbox_workspace_info\` — get workspace status (path, root files, id)

### Key Constraints
- **One command per call.** Each \`sandbox_exec\` invocation runs a single command. Shell metacharacters (\`&&\`, \`||\`, \`;\`, \`|\`, \`$\`) are blocked by the security validator. For multi-step workflows, make separate sequential \`sandbox_exec\` calls.
- **Output truncation.** Command stdout/stderr is truncated at ~10 KB. For large outputs, redirect to a file (e.g. \`grep pattern file > results.txt\`) and use \`sandbox_read_file\` to read it.
- **Working directory is /workspace.** Every command starts in /workspace. \`cd\` does not persist between calls — use relative paths from /workspace or provide full paths as arguments.
- **Allowed binaries only.** Only pre-approved commands are permitted. If a command is blocked, the error message lists what is allowed.

### When to Use Sandbox vs CLI Tools
- **Sandbox** — tasks that produce files, require setup (clone, install, build), involve multi-step workflows, or need a persistent working directory.
- **CLI tools** (\`aws_cli\`, \`github_cli\`, \`curl_fetch\`) — one-off queries like checking an AWS resource, fetching a URL, or listing GitHub issues.

### Effective Patterns
- **Orientation first.** At the start of a workspace task, call \`sandbox_workspace_info\` or \`sandbox_list_files\` to see what already exists from previous turns.
- **Write files directly.** Prefer \`sandbox_write_file\` over \`echo\` redirection in \`sandbox_exec\` — it handles any content length and avoids quoting issues.
- **Sequential execution.** Break multi-step tasks into individual \`sandbox_exec\` calls. Check the exit code and stderr after each step before proceeding.
- **Error recovery.** If a command fails, read the stderr output, diagnose the issue, and try an alternative approach. Always report failures to the user.`;
}

const skillsLoader = new SkillsLoader();

const injectionTracker = new Map<string, boolean>();

const TOOL_CATEGORIES: Record<string, (name: string) => boolean> = {
  Identity: (n) => n.startsWith('identity_') || n === 'team_context_set',
  Memory: (n) => n.startsWith('memory_'),
  Browser: (n) => n.startsWith('browser_'),
  CLI: (n) => ['aws_cli', 'github_cli', 'curl_fetch'].includes(n),
  Schedules: (n) => n.startsWith('schedule_'),
  Sandbox: (n) => n.startsWith('sandbox_'),
};

const INTERNAL_TOOLS = new Set(['confirm_plan']);

export interface ComposeResult {
  systemPrompt: string;
  loadedSkillIds: string[];
}

export class PromptComposer {
  async compose(
    channelId: string,
    memories: ChannelMemory[],
    toolNames: string[] = [],
    safeToolNames: Set<string> = new Set(),
  ): Promise<ComposeResult> {
    let mode: PromptInjectMode = 'every-turn';
    let identity = 'You are PersonalClaw, an AI assistant for this channel.';
    let teamContext = '';
    let autonomyLevel: AutonomyLevel = 'balanced';

    try {
      const channel = await getCachedConfig(channelId);

      if (channel) {
        if (channel.identityPrompt) identity = channel.identityPrompt;
        if (channel.teamPrompt) teamContext = channel.teamPrompt;
        mode = (channel.promptInjectMode as PromptInjectMode) || 'every-turn';
        const parsedAutonomy = autonomyLevelSchema.safeParse(channel.autonomyLevel);
        autonomyLevel = parsedAutonomy.success ? parsedAutonomy.data : 'balanced';
      }
    } catch (error) {
      logger.warn('Failed to load channel config for prompt', {
        channelId,
        ...errorDetails(error),
      });
    }

    const executionProtocol = buildExecutionProtocol(safeToolNames, autonomyLevel);

    const sandboxSection = buildSandboxSection(toolNames);

    if (mode === 'once' && injectionTracker.has(channelId)) {
      const prompt = [sandboxSection, this.buildMemorySection(memories), executionProtocol]
        .filter(Boolean)
        .join('\n\n');
      return { systemPrompt: prompt, loadedSkillIds: [] };
    }

    if (mode === 'minimal') {
      injectionTracker.set(channelId, true);
      const parts = [identity];
      if (sandboxSection) parts.push(sandboxSection);
      const memorySection = this.buildMemorySection(memories);
      if (memorySection) parts.push(memorySection);
      parts.push(executionProtocol);
      return { systemPrompt: parts.join('\n\n'), loadedSkillIds: [] };
    }

    injectionTracker.set(channelId, true);

    const parts = [identity];
    if (teamContext) parts.push(teamContext);

    const loadedSkills: LoadedSkill[] = await skillsLoader.loadForChannel(channelId);
    if (loadedSkills.length > 0) {
      parts.push(`## Skills\n\n${loadedSkills.map((s) => s.content).join('\n\n---\n\n')}`);
    }

    const capabilitiesSection = this.buildCapabilitiesSection(toolNames);
    if (capabilitiesSection) parts.push(capabilitiesSection);

    if (sandboxSection) parts.push(sandboxSection);

    const memorySection = this.buildMemorySection(memories);
    if (memorySection) parts.push(memorySection);

    parts.push(executionProtocol);

    return {
      systemPrompt: parts.join('\n\n'),
      loadedSkillIds: loadedSkills.map((s) => s.id),
    };
  }

  private buildCapabilitiesSection(toolNames: string[]): string {
    const visible = toolNames.filter((n) => !INTERNAL_TOOLS.has(n));
    if (visible.length === 0) return '';

    const grouped = new Map<string, string[]>();
    const uncategorized: string[] = [];

    for (const name of visible) {
      let matched = false;
      for (const [category, predicate] of Object.entries(TOOL_CATEGORIES)) {
        if (predicate(name)) {
          const list = grouped.get(category) ?? [];
          list.push(name);
          grouped.set(category, list);
          matched = true;
          break;
        }
      }
      if (!matched) uncategorized.push(name);
    }

    const lines = ['## Available Tools', ''];
    for (const [category, tools] of grouped) {
      lines.push(`**${category}:** ${tools.join(', ')}`);
    }
    if (uncategorized.length > 0) {
      lines.push(`**Integrations:** ${uncategorized.join(', ')}`);
    }
    lines.push(
      '',
      'When asked what you can do, refer to this list. Do not guess or fabricate capabilities.',
    );

    return lines.join('\n');
  }

  private buildMemorySection(memories: ChannelMemory[]): string {
    if (memories.length === 0) return '';
    return `## Relevant Memories\n${memories.map((m) => `- [${m.category}] ${m.content}`).join('\n')}`;
  }
}
