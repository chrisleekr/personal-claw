import { getLogger } from '@logtape/logtape';
import { type GuardrailsConfig, guardrailsConfigSchema } from '@personalclaw/shared';
import { getCachedConfig } from '../channels/config-cache';
import { errorDetails } from '../utils/error-fmt';
import { maskPII } from '../utils/pii-masker';

const logger = getLogger(['personalclaw', 'agent', 'guardrails']);

const DEFAULT_GUARDRAILS: GuardrailsConfig = {
  preProcessing: {
    contentFiltering: true,
    intentClassification: false,
    maxInputLength: 50000,
  },
  postProcessing: {
    piiRedaction: true,
    outputValidation: true,
  },
};

export class GuardrailsEngine {
  private configCache = new Map<string, { config: GuardrailsConfig; loadedAt: number }>();
  private static CACHE_TTL_MS = 60_000;

  private async getConfig(channelId: string): Promise<GuardrailsConfig> {
    const cached = this.configCache.get(channelId);
    if (cached && Date.now() - cached.loadedAt < GuardrailsEngine.CACHE_TTL_MS) {
      return cached.config;
    }

    try {
      const row = await getCachedConfig(channelId);

      if (!row?.guardrailsConfig) {
        this.configCache.set(channelId, { config: DEFAULT_GUARDRAILS, loadedAt: Date.now() });
        return DEFAULT_GUARDRAILS;
      }

      const parsed = guardrailsConfigSchema.safeParse(row.guardrailsConfig);
      const config = parsed.success ? (parsed.data as GuardrailsConfig) : DEFAULT_GUARDRAILS;

      if (!parsed.success) {
        logger.warn('Invalid guardrails config, using defaults', {
          channelId,
          errors: parsed.error.issues,
        });
      }

      this.configCache.set(channelId, { config, loadedAt: Date.now() });
      return config;
    } catch (error) {
      logger.warn('Failed to load guardrails config, using defaults', {
        channelId,
        ...errorDetails(error),
      });
      return DEFAULT_GUARDRAILS;
    }
  }

  async preProcess(params: { channelId: string; text: string }): Promise<{ text: string }> {
    const config = await this.getConfig(params.channelId);
    let text = params.text;

    if (config.preProcessing.contentFiltering) {
      text = text.replace(/ignore previous instructions/gi, '[filtered]');
      text = text.replace(/system:\s*/gi, '[filtered]');
    }

    const maxLen = config.preProcessing.maxInputLength;
    if (text.length > maxLen) {
      text = `${text.slice(0, maxLen)}\n[Message truncated]`;
    }

    return { text };
  }

  async postProcess(response: string, channelId: string): Promise<string> {
    const config = await this.getConfig(channelId);

    if (config.postProcessing.piiRedaction) {
      return maskPII(response);
    }

    return response;
  }
}
