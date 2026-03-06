import { describe, expect, test } from 'bun:test';
import {
  BUDGET_ALERT_EXCEEDED_THRESHOLD,
  BUDGET_ALERT_WARNING_THRESHOLD,
  COMPACTION_TOKEN_THRESHOLD,
  DEFAULT_HEARTBEAT_CRON,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_MEMORY_CONFIG,
  DEFAULT_MODEL,
  DEFAULT_PROMPT_INJECT_MODE,
  DEFAULT_PROVIDER,
  MEMORY_DECAY_DAYS,
  MODEL_PRICING,
  SKILL_AUTO_GEN_MIN_OCCURRENCES,
  SKILL_AUTO_GEN_MIN_SUCCESS_RATE,
  SLASH_COMMANDS,
  VALKEY_KEYS,
  VALKEY_TTL,
} from '../constants';

describe('VALKEY_KEYS', () => {
  test('threadState builds correct key', () => {
    expect(VALKEY_KEYS.threadState('ch1', 't1')).toBe('thread:ch1:t1');
  });

  test('channelConfig builds correct key', () => {
    expect(VALKEY_KEYS.channelConfig('ch1')).toBe('config:ch1');
  });

  test('channelResolver builds correct key', () => {
    expect(VALKEY_KEYS.channelResolver('slack', 'C123')).toBe('ch:slack:C123');
  });

  test('subtaskResult builds correct key', () => {
    expect(VALKEY_KEYS.subtaskResult('task-abc')).toBe('subtask:task-abc');
  });

  test('rateLimitUser builds correct key', () => {
    expect(VALKEY_KEYS.rateLimitUser('ch1', 'u1')).toBe('ratelimit:ch1:u1');
  });

  test('budgetAlert builds correct key', () => {
    expect(VALKEY_KEYS.budgetAlert('ch1', '2026-03-01', 'warning')).toBe(
      'budget-alert:ch1:2026-03-01:warning',
    );
  });

  test('feedbackMeta builds correct key', () => {
    expect(VALKEY_KEYS.feedbackMeta('ch1', 't1')).toBe('feedback:ch1:t1');
  });
});

describe('VALKEY_TTL', () => {
  test('all TTL values are positive integers', () => {
    for (const [_key, value] of Object.entries(VALKEY_TTL)) {
      expect(typeof value).toBe('number');
      expect(value).toBeGreaterThan(0);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  test('threadState TTL is 24 hours', () => {
    expect(VALKEY_TTL.threadState).toBe(86400);
  });
});

describe('MODEL_PRICING', () => {
  test('all models have positive promptPerMillion', () => {
    for (const [_model, pricing] of Object.entries(MODEL_PRICING)) {
      expect(pricing.promptPerMillion).toBeGreaterThan(0);
    }
  });

  test('all models have positive completionPerMillion', () => {
    for (const [_model, pricing] of Object.entries(MODEL_PRICING)) {
      expect(pricing.completionPerMillion).toBeGreaterThan(0);
    }
  });

  test('completion cost is always >= prompt cost', () => {
    for (const [_model, pricing] of Object.entries(MODEL_PRICING)) {
      expect(pricing.completionPerMillion).toBeGreaterThanOrEqual(pricing.promptPerMillion);
    }
  });

  test('contains expected Anthropic models', () => {
    expect(MODEL_PRICING['claude-sonnet-4-20250514']).toBeDefined();
    expect(MODEL_PRICING['claude-opus-4-20250514']).toBeDefined();
  });

  test('contains expected OpenAI models', () => {
    expect(MODEL_PRICING['gpt-4o']).toBeDefined();
    expect(MODEL_PRICING['gpt-4o-mini']).toBeDefined();
  });
});

describe('threshold constants', () => {
  test('COMPACTION_TOKEN_THRESHOLD is a large positive number', () => {
    expect(COMPACTION_TOKEN_THRESHOLD).toBeGreaterThan(0);
    expect(COMPACTION_TOKEN_THRESHOLD).toBe(80000);
  });

  test('budget thresholds are in expected range', () => {
    expect(BUDGET_ALERT_WARNING_THRESHOLD).toBe(0.8);
    expect(BUDGET_ALERT_EXCEEDED_THRESHOLD).toBe(1.0);
    expect(BUDGET_ALERT_WARNING_THRESHOLD).toBeLessThan(BUDGET_ALERT_EXCEEDED_THRESHOLD);
  });

  test('MEMORY_DECAY_DAYS is positive', () => {
    expect(MEMORY_DECAY_DAYS).toBeGreaterThan(0);
  });

  test('SKILL_AUTO_GEN thresholds are sensible', () => {
    expect(SKILL_AUTO_GEN_MIN_OCCURRENCES).toBeGreaterThan(0);
    expect(SKILL_AUTO_GEN_MIN_SUCCESS_RATE).toBeGreaterThan(0);
    expect(SKILL_AUTO_GEN_MIN_SUCCESS_RATE).toBeLessThanOrEqual(1);
  });
});

describe('default constants', () => {
  test('DEFAULT_MODEL is a string', () => {
    expect(typeof DEFAULT_MODEL).toBe('string');
    expect(DEFAULT_MODEL.length).toBeGreaterThan(0);
  });

  test('DEFAULT_PROVIDER is anthropic', () => {
    expect(DEFAULT_PROVIDER).toBe('anthropic');
  });

  test('DEFAULT_MAX_ITERATIONS is 10', () => {
    expect(DEFAULT_MAX_ITERATIONS).toBe(10);
  });

  test('DEFAULT_MEMORY_CONFIG has expected shape', () => {
    expect(DEFAULT_MEMORY_CONFIG.maxMemories).toBe(200);
    expect(DEFAULT_MEMORY_CONFIG.injectTopN).toBe(10);
  });

  test('DEFAULT_PROMPT_INJECT_MODE is every-turn', () => {
    expect(DEFAULT_PROMPT_INJECT_MODE).toBe('every-turn');
  });

  test('DEFAULT_HEARTBEAT_CRON is a valid cron expression', () => {
    expect(DEFAULT_HEARTBEAT_CRON).toMatch(/^[\d*/,\- ]+$/);
  });
});

describe('SLASH_COMMANDS', () => {
  test('contains expected commands', () => {
    expect(SLASH_COMMANDS).toContain('help');
    expect(SLASH_COMMANDS).toContain('status');
    expect(SLASH_COMMANDS).toContain('model');
    expect(SLASH_COMMANDS).toContain('memory');
    expect(SLASH_COMMANDS).toContain('compact');
  });

  test('all entries are non-empty strings', () => {
    for (const cmd of SLASH_COMMANDS) {
      expect(typeof cmd).toBe('string');
      expect(cmd.length).toBeGreaterThan(0);
    }
  });
});
