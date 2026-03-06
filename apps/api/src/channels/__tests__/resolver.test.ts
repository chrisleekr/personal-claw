import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { ChannelNotFoundError, ChannelResolver } from '../resolver';

const MOCK_CHANNEL = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  platform: 'slack' as const,
  externalId: 'C0AH4ASPAFP',
};

let mockDbRows: Array<{ id: string; platform: string; externalId: string }> = [];
let mockValkeyStore: Record<string, string> = {};
let mockValkeyAvailable = false;

mock.module('../../db', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => [...mockDbRows],
      }),
    }),
  }),
}));

mock.module('../../redis', () => ({
  isRedisAvailable: () => mockValkeyAvailable,
  getRedis: () => ({
    get: async (key: string) => mockValkeyStore[key] ?? null,
    set: async (key: string, value: string) => {
      mockValkeyStore[key] = value;
    },
    del: async (key: string) => {
      delete mockValkeyStore[key];
    },
  }),
}));

function freshResolver(): ChannelResolver {
  return new (ChannelResolver as unknown as { new (): ChannelResolver })();
}

describe('ChannelResolver', () => {
  let resolver: ChannelResolver;

  beforeEach(() => {
    resolver = freshResolver();
    mockDbRows = [];
    mockValkeyStore = {};
    mockValkeyAvailable = false;
  });

  afterEach(() => {
    mockDbRows = [];
    mockValkeyStore = {};
    mockValkeyAvailable = false;
  });

  describe('resolve', () => {
    test('returns channel from DB on cache miss', async () => {
      mockDbRows = [MOCK_CHANNEL];

      const result = await resolver.resolve('slack', 'C0AH4ASPAFP');
      expect(result).toEqual(MOCK_CHANNEL);
    });

    test('returns channel from memory cache on second call', async () => {
      mockDbRows = [MOCK_CHANNEL];

      const first = await resolver.resolve('slack', 'C0AH4ASPAFP');
      mockDbRows = [];

      const second = await resolver.resolve('slack', 'C0AH4ASPAFP');
      expect(second).toEqual(first);
    });

    test('populates Valkey cache when available', async () => {
      mockValkeyAvailable = true;
      mockDbRows = [MOCK_CHANNEL];

      await resolver.resolve('slack', 'C0AH4ASPAFP');

      const cached = mockValkeyStore['ch:slack:C0AH4ASPAFP'];
      expect(cached).toBeDefined();
      expect(JSON.parse(cached)).toEqual(MOCK_CHANNEL);
    });

    test('reads from Valkey cache on memory miss', async () => {
      mockValkeyAvailable = true;
      mockValkeyStore['ch:slack:C0AH4ASPAFP'] = JSON.stringify(MOCK_CHANNEL);
      mockDbRows = [];

      const result = await resolver.resolve('slack', 'C0AH4ASPAFP');
      expect(result).toEqual(MOCK_CHANNEL);
    });

    test('throws ChannelNotFoundError when channel does not exist', async () => {
      mockDbRows = [];

      expect(resolver.resolve('slack', 'CNOTFOUND')).rejects.toThrow(ChannelNotFoundError);
    });

    test('ChannelNotFoundError contains platform and externalId', async () => {
      mockDbRows = [];

      try {
        await resolver.resolve('slack', 'CNOTFOUND');
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(ChannelNotFoundError);
        const err = error as ChannelNotFoundError;
        expect(err.platform).toBe('slack');
        expect(err.externalId).toBe('CNOTFOUND');
      }
    });
  });

  describe('invalidate', () => {
    test('clears memory cache by channel UUID', async () => {
      mockDbRows = [MOCK_CHANNEL];
      await resolver.resolve('slack', 'C0AH4ASPAFP');

      resolver.invalidate(MOCK_CHANNEL.id);

      mockDbRows = [];
      expect(resolver.resolve('slack', 'C0AH4ASPAFP')).rejects.toThrow(ChannelNotFoundError);
    });

    test('invalidateByExternal clears memory cache by platform+externalId', async () => {
      mockDbRows = [MOCK_CHANNEL];
      await resolver.resolve('slack', 'C0AH4ASPAFP');

      resolver.invalidateByExternal('slack', 'C0AH4ASPAFP');

      mockDbRows = [];
      expect(resolver.resolve('slack', 'C0AH4ASPAFP')).rejects.toThrow(ChannelNotFoundError);
    });
  });

  describe('singleton', () => {
    test('getInstance returns the same instance', () => {
      const a = ChannelResolver.getInstance();
      const b = ChannelResolver.getInstance();
      expect(a).toBe(b);
    });
  });
});
