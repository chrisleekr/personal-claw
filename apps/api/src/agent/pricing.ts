import { getLogger } from '@logtape/logtape';
import { MODEL_PRICING } from '@personalclaw/shared';

const logger = getLogger(['personalclaw', 'agent', 'pricing']);

export interface ModelPricing {
  promptPerMillion: number;
  completionPerMillion: number;
}

const registry = new Map<string, ModelPricing>();

for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
  registry.set(model, pricing);
}

export function getModelPricing(model: string): ModelPricing | null {
  return registry.get(model) ?? null;
}

export function calculateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const pricing = registry.get(model);
  if (!pricing) {
    logger.warn('No pricing found for model, cost will be $0', { model });
    return 0;
  }
  return (
    (promptTokens * pricing.promptPerMillion + completionTokens * pricing.completionPerMillion) /
    1_000_000
  );
}

export function listRegisteredModels(): string[] {
  return [...registry.keys()];
}
