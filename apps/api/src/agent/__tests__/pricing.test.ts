import { describe, expect, test } from 'bun:test';
import { MODEL_PRICING } from '@personalclaw/shared';
import { calculateCost, getModelPricing, listRegisteredModels } from '../pricing';

describe('getModelPricing', () => {
  test('returns pricing for a known Anthropic model', () => {
    const pricing = getModelPricing('claude-sonnet-4-20250514');
    expect(pricing).not.toBeNull();
    expect(pricing?.promptPerMillion).toBe(3);
    expect(pricing?.completionPerMillion).toBe(15);
  });

  test('returns pricing for a known OpenAI model', () => {
    const pricing = getModelPricing('gpt-4o');
    expect(pricing).not.toBeNull();
    expect(pricing?.promptPerMillion).toBe(2.5);
    expect(pricing?.completionPerMillion).toBe(10);
  });

  test('returns null for unknown model', () => {
    expect(getModelPricing('nonexistent-model-v99')).toBeNull();
  });
});

describe('calculateCost', () => {
  test('calculates cost correctly for known model', () => {
    // claude-sonnet-4: prompt=3/M, completion=15/M
    const cost = calculateCost('claude-sonnet-4-20250514', 1_000_000, 1_000_000);
    expect(cost).toBe(3 + 15);
  });

  test('calculates fractional cost', () => {
    const cost = calculateCost('claude-sonnet-4-20250514', 1000, 500);
    const expected = (1000 * 3 + 500 * 15) / 1_000_000;
    expect(cost).toBeCloseTo(expected);
  });

  test('returns 0 for zero tokens', () => {
    expect(calculateCost('claude-sonnet-4-20250514', 0, 0)).toBe(0);
  });

  test('returns 0 for unknown model', () => {
    expect(calculateCost('unknown-model', 1000, 1000)).toBe(0);
  });
});

describe('listRegisteredModels', () => {
  test('returns all models from MODEL_PRICING', () => {
    const models = listRegisteredModels();
    const expected = Object.keys(MODEL_PRICING);
    expect(models).toHaveLength(expected.length);
    for (const key of expected) {
      expect(models).toContain(key);
    }
  });

  test('returns an array of strings', () => {
    const models = listRegisteredModels();
    expect(Array.isArray(models)).toBe(true);
    for (const m of models) {
      expect(typeof m).toBe('string');
    }
  });
});
