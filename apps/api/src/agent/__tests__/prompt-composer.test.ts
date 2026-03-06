import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ChannelMemory } from '@personalclaw/shared';

let mockConfigReturn: unknown = null;
let mockSkillRows: Array<{ id: string; content: string; channelId: string }> = [];

mock.module('../../channels/config-cache', () => ({
  getCachedConfig: async () => mockConfigReturn,
}));

function chainable(getRows: () => unknown[]): unknown {
  const methods: Record<string, unknown> = {};
  for (const name of ['from', 'where', 'orderBy', 'limit', 'groupBy', 'returning']) {
    methods[name] = () => chainable(getRows);
  }
  return Object.assign([...getRows()], methods);
}

mock.module('../../db', () => ({
  getDb: () => ({
    select: () => chainable(() => mockSkillRows),
  }),
}));

import { PromptComposer } from '../prompt-composer';

describe('PromptComposer', () => {
  let composer: PromptComposer;
  const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';

  beforeEach(() => {
    composer = new PromptComposer();
    mockConfigReturn = null;
    mockSkillRows = [];
  });

  afterEach(() => {
    mockConfigReturn = null;
    mockSkillRows = [];
  });

  describe('compose', () => {
    test('produces a system prompt with default identity', async () => {
      const result = await composer.compose(CHANNEL_ID, []);
      expect(result.systemPrompt).toContain('PersonalClaw');
      expect(result.loadedSkillIds).toEqual([]);
    });

    test('uses custom identity from channel config', async () => {
      mockConfigReturn = {
        identityPrompt: 'You are HelperBot, a coding assistant.',
        promptInjectMode: 'every-turn',
        autonomyLevel: 'balanced',
      };
      const result = await composer.compose(CHANNEL_ID, []);
      expect(result.systemPrompt).toContain('HelperBot');
      expect(result.systemPrompt).not.toContain('PersonalClaw');
    });

    test('includes team context when configured', async () => {
      mockConfigReturn = {
        identityPrompt: 'You are an assistant.',
        teamPrompt: 'The team uses TypeScript and Bun.',
        promptInjectMode: 'every-turn',
        autonomyLevel: 'balanced',
      };
      const result = await composer.compose(CHANNEL_ID, []);
      expect(result.systemPrompt).toContain('TypeScript and Bun');
    });

    test('includes skills section when skills are loaded', async () => {
      const skillChannelId = '660e8400-e29b-41d4-a716-446655440001';
      mockSkillRows = [
        { id: 'skill-1', content: 'You can deploy to AWS.', channelId: skillChannelId },
        { id: 'skill-2', content: 'You can manage databases.', channelId: skillChannelId },
      ];
      const result = await composer.compose(skillChannelId, []);
      expect(result.systemPrompt).toContain('## Skills');
      expect(result.systemPrompt).toContain('deploy to AWS');
      expect(result.systemPrompt).toContain('manage databases');
      expect(result.loadedSkillIds).toEqual(['skill-1', 'skill-2']);
    });

    test('includes memory section when memories are provided', async () => {
      const memories: ChannelMemory[] = [
        {
          id: 'mem-1',
          channelId: CHANNEL_ID,
          content: 'User prefers dark mode',
          category: 'preference',
          recallCount: 3,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      const result = await composer.compose(CHANNEL_ID, memories);
      expect(result.systemPrompt).toContain('## Relevant Memories');
      expect(result.systemPrompt).toContain('[preference] User prefers dark mode');
    });

    test('excludes memory section when no memories', async () => {
      const result = await composer.compose(CHANNEL_ID, []);
      expect(result.systemPrompt).not.toContain('## Relevant Memories');
    });

    test('includes execution protocol', async () => {
      const result = await composer.compose(CHANNEL_ID, []);
      expect(result.systemPrompt).toContain('## Execution Protocol');
      expect(result.systemPrompt).toContain('Conversation vs Action');
    });

    test('lists safe tool names as autonomous', async () => {
      const safeTools = new Set(['memory_search', 'identity_get']);
      const result = await composer.compose(
        CHANNEL_ID,
        [],
        ['memory_search', 'identity_get'],
        safeTools,
      );
      expect(result.systemPrompt).toContain('`memory_search`');
      expect(result.systemPrompt).toContain('`identity_get`');
    });

    test('shows "none configured" when no safe tools', async () => {
      const result = await composer.compose(CHANNEL_ID, [], [], new Set());
      expect(result.systemPrompt).toContain('_none configured_');
    });

    test('includes sandbox section when sandbox tools are present', async () => {
      const toolNames = ['sandbox_exec', 'sandbox_write_file', 'memory_search'];
      const result = await composer.compose(CHANNEL_ID, [], toolNames);
      expect(result.systemPrompt).toContain('## Sandbox Workspace');
      expect(result.systemPrompt).toContain('sandbox_exec');
    });

    test('excludes sandbox section when no sandbox tools', async () => {
      const toolNames = ['memory_search', 'identity_get'];
      const result = await composer.compose(CHANNEL_ID, [], toolNames);
      expect(result.systemPrompt).not.toContain('## Sandbox Workspace');
    });

    test('includes capabilities section grouping tools by category', async () => {
      const toolNames = [
        'memory_search',
        'memory_save',
        'identity_get',
        'aws_cli',
        'sandbox_exec',
        'some_custom_tool',
      ];
      const result = await composer.compose(CHANNEL_ID, [], toolNames);
      expect(result.systemPrompt).toContain('## Available Tools');
      expect(result.systemPrompt).toContain('**Memory:**');
      expect(result.systemPrompt).toContain('**Identity:**');
      expect(result.systemPrompt).toContain('**CLI:**');
      expect(result.systemPrompt).toContain('**Integrations:**');
    });

    test('excludes confirm_plan from capabilities section', async () => {
      const toolNames = ['confirm_plan', 'memory_search'];
      const result = await composer.compose(CHANNEL_ID, [], toolNames);
      const capsSection = result.systemPrompt.split('## Available Tools')[1]?.split('##')[0] ?? '';
      expect(capsSection).not.toContain('confirm_plan');
      expect(capsSection).toContain('memory_search');
    });

    test('handles autonomous autonomy level', async () => {
      mockConfigReturn = {
        promptInjectMode: 'every-turn',
        autonomyLevel: 'autonomous',
      };
      const result = await composer.compose(CHANNEL_ID, []);
      expect(result.systemPrompt).toContain('destructive or irreversible');
    });

    test('handles cautious autonomy level', async () => {
      mockConfigReturn = {
        promptInjectMode: 'every-turn',
        autonomyLevel: 'cautious',
      };
      const result = await composer.compose(CHANNEL_ID, []);
      expect(result.systemPrompt).toContain('ask the user for clarification');
    });

    test('minimal mode includes identity but omits skills', async () => {
      mockConfigReturn = {
        identityPrompt: 'I am MinimalBot.',
        promptInjectMode: 'minimal',
        autonomyLevel: 'balanced',
      };
      mockSkillRows = [{ id: 's1', content: 'skill content', channelId: CHANNEL_ID }];
      const result = await composer.compose(CHANNEL_ID, []);
      expect(result.systemPrompt).toContain('MinimalBot');
      expect(result.systemPrompt).not.toContain('## Skills');
      expect(result.loadedSkillIds).toEqual([]);
    });
  });
});
