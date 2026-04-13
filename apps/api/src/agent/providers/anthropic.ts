import { anthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import { config } from '../../config';
import type { ProviderFactory } from './types';

export const anthropicFactory: ProviderFactory = {
  name: 'anthropic',
  defaultModel: 'claude-sonnet-4-20250514',

  create(model: string): LanguageModel {
    return anthropic(model);
  },

  isConfigured(): boolean {
    const key = config.ANTHROPIC_API_KEY;
    if (!key) return false;
    // OAuth tokens (`sk-ant-oat*`) authenticate the Claude Code CLI and
    // the claude.ai web interface but are rejected by `@ai-sdk/anthropic`
    // with `"invalid x-api-key"`. Treat them as unconfigured so callers
    // that check `isConfigured()` fall back to a working provider via the
    // registry rather than routing to a dead endpoint.
    if (key.startsWith('sk-ant-oat')) return false;
    return true;
  },
};
