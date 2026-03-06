import { getLogger } from '@logtape/logtape';
import type { ConversationMessage, SkillDraft } from '@personalclaw/shared';
import { generateText, stepCountIs } from 'ai';
import { Hono } from 'hono';
import { getProvider } from '../agent/provider';
import { services } from '../services/container';
import { errorDetails } from '../utils/error-fmt';

const logger = getLogger(['personalclaw', 'routes', 'conversations']);
const conversationService = services.conversations;

export const conversationsRoute = new Hono();

conversationsRoute.get('/:channelId', async (c) => {
  const rows = await conversationService.listByChannel(c.req.param('channelId'));
  return c.json({ data: rows });
});

conversationsRoute.get('/:channelId/:id', async (c) => {
  const row = await conversationService.getById(c.req.param('channelId'), c.req.param('id'));
  return c.json({ data: row });
});

conversationsRoute.post('/:channelId/:id/generate-skill', async (c) => {
  const channelId = c.req.param('channelId');
  const id = c.req.param('id');
  const row = await conversationService.getById(channelId, id);

  const messages = (row.messages ?? []) as ConversationMessage[];
  const toolCalls = messages.flatMap((m) => m.toolCalls ?? []);

  if (toolCalls.length === 0) {
    return c.json(
      {
        error: 'NO_TOOL_CALLS',
        message: 'This conversation has no tool calls to build a skill from.',
      },
      400,
    );
  }

  const toolSequenceSummary = toolCalls
    .map((tc) => {
      const argsPreview = Object.keys(tc.args).slice(0, 3).join(', ');
      return `- ${tc.toolName}(${argsPreview})`;
    })
    .join('\n');

  const userMessages = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n');

  const { provider, model } = await getProvider(channelId);

  try {
    const result = await generateText({
      model: provider(model),
      prompt: `You are a skill author for an AI agent. Analyze the following conversation and create a reusable skill.

## User requests
${userMessages}

## Tool calls executed
${toolSequenceSummary}

Write a JSON object with two fields:
- "name": A short, descriptive name for this skill (max 80 chars)
- "content": Markdown instructions for the skill that describe:
  1. When to use this skill (trigger conditions)
  2. Step-by-step instructions the agent should follow
  3. Which tools to use and in what order

Keep the content under 500 words. Output ONLY valid JSON, no markdown fences.`,
      stopWhen: stepCountIs(1),
    });

    let draft: SkillDraft;
    try {
      const raw = result.text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
      const parsed = JSON.parse(raw) as { name?: string; content?: string };
      draft = {
        name: typeof parsed.name === 'string' ? parsed.name.slice(0, 100) : 'Untitled Skill',
        content: typeof parsed.content === 'string' ? parsed.content : result.text,
      };
    } catch {
      draft = {
        name: `Skill from ${toolCalls[0].toolName}`,
        content: result.text,
      };
    }

    return c.json({ data: draft });
  } catch (error) {
    const details = errorDetails(error);
    logger.error('Failed to generate skill draft', { channelId, conversationId: id, ...details });
    return c.json(
      {
        error: 'GENERATION_FAILED',
        message: details.error ?? 'Failed to generate skill draft.',
      },
      500,
    );
  }
});
