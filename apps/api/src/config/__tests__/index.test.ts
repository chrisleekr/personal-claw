import { describe, expect, test } from 'bun:test';

describe('config', () => {
  test('exports config object with parsed env values', async () => {
    const { config } = await import('../index');
    expect(config).toBeDefined();
    expect(typeof config.PORT).toBe('number');
    expect(typeof config.NODE_ENV).toBe('string');
    expect(['development', 'production', 'test']).toContain(config.NODE_ENV);
  });

  test('config has DATABASE_URL set', async () => {
    const { config } = await import('../index');
    expect(config.DATABASE_URL).toBeDefined();
    expect(config.DATABASE_URL.length).toBeGreaterThan(0);
  });

  test('config has LLM_PROVIDER set', async () => {
    const { config } = await import('../index');
    expect(typeof config.LLM_PROVIDER).toBe('string');
    expect(config.LLM_PROVIDER.length).toBeGreaterThan(0);
  });

  test('config has TRANSCRIPT_DIR set', async () => {
    const { config } = await import('../index');
    expect(typeof config.TRANSCRIPT_DIR).toBe('string');
    expect(config.TRANSCRIPT_DIR.length).toBeGreaterThan(0);
  });

  test('config PORT coerces to number', async () => {
    const { config } = await import('../index');
    expect(config.PORT).toEqual(expect.any(Number));
  });

  test('config.type satisfies AppConfig', async () => {
    const { config } = await import('../index');
    expect(config).toHaveProperty('NODE_ENV');
    expect(config).toHaveProperty('PORT');
    expect(config).toHaveProperty('DATABASE_URL');
    expect(config).toHaveProperty('LLM_PROVIDER');
  });
});

describe('redisUrl', () => {
  test('returns VALKEY_URL when set', async () => {
    const { config, redisUrl } = await import('../index');
    const original = config.VALKEY_URL;
    (config as Record<string, unknown>).VALKEY_URL = 'redis://valkey:6379';
    (config as Record<string, unknown>).REDIS_URL = 'redis://redis:6379';

    expect(redisUrl()).toBe('redis://valkey:6379');

    (config as Record<string, unknown>).VALKEY_URL = original;
  });

  test('falls back to REDIS_URL when VALKEY_URL is not set', async () => {
    const { config, redisUrl } = await import('../index');
    const origValkey = config.VALKEY_URL;
    const origRedis = config.REDIS_URL;
    (config as Record<string, unknown>).VALKEY_URL = undefined;
    (config as Record<string, unknown>).REDIS_URL = 'redis://my-redis:6380';

    expect(redisUrl()).toBe('redis://my-redis:6380');

    (config as Record<string, unknown>).VALKEY_URL = origValkey;
    (config as Record<string, unknown>).REDIS_URL = origRedis;
  });

  test('falls back to localhost when neither URL is set', async () => {
    const { config, redisUrl } = await import('../index');
    const origValkey = config.VALKEY_URL;
    const origRedis = config.REDIS_URL;
    (config as Record<string, unknown>).VALKEY_URL = undefined;
    (config as Record<string, unknown>).REDIS_URL = undefined;

    expect(redisUrl()).toBe('redis://localhost:6379');

    (config as Record<string, unknown>).VALKEY_URL = origValkey;
    (config as Record<string, unknown>).REDIS_URL = origRedis;
  });
});
