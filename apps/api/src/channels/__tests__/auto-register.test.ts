import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ChannelPlatform } from '@personalclaw/shared';

const MOCK_UUID = '550e8400-e29b-41d4-a716-446655440000';

let insertedRow: { id: string } | undefined;
let selectRows: Array<{ id: string }> = [];
let updateCalls: Array<{ set: Record<string, unknown> }> = [];
let enrichResult: string | null = null;

mock.module('../../db', () => ({
  getDb: () => ({
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: () => (insertedRow ? [insertedRow] : []),
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => [...selectRows],
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updateCalls.push({ set: values });
        return {
          where: () => Promise.resolve(),
        };
      },
    }),
  }),
}));

mock.module('../../platforms/registry', () => ({
  PlatformRegistry: {
    enrichChannelName: mock((_platform: string, _externalId: string, _channelId: string) =>
      Promise.resolve(enrichResult),
    ),
  },
}));

let autoRegisterChannel: (
  platform: ChannelPlatform,
  externalId: string,
) => Promise<{
  id: string;
  platform: ChannelPlatform;
  externalId: string;
}>;

beforeEach(async () => {
  insertedRow = undefined;
  selectRows = [];
  updateCalls = [];
  enrichResult = null;

  const mod = await import('../auto-register');
  autoRegisterChannel = mod.autoRegisterChannel;
});

describe('autoRegisterChannel', () => {
  test('creates a new channel and returns ResolvedChannel', async () => {
    insertedRow = { id: MOCK_UUID };

    const result = await autoRegisterChannel('slack', 'C0AH4ASPAFP');

    expect(result).toEqual({
      id: MOCK_UUID,
      platform: 'slack',
      externalId: 'C0AH4ASPAFP',
    });
  });

  test('falls back to SELECT on conflict (race condition)', async () => {
    insertedRow = undefined;
    selectRows = [{ id: MOCK_UUID }];

    const result = await autoRegisterChannel('slack', 'C0AH4ASPAFP');

    expect(result).toEqual({
      id: MOCK_UUID,
      platform: 'slack',
      externalId: 'C0AH4ASPAFP',
    });
  });

  test('enriches channel name when platform plugin provides one', async () => {
    insertedRow = { id: MOCK_UUID };
    enrichResult = 'general';

    await autoRegisterChannel('slack', 'C0AH4ASPAFP');

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].set).toMatchObject({ externalName: 'general' });
  });

  test('succeeds even when enrichment fails', async () => {
    insertedRow = { id: MOCK_UUID };
    enrichResult = null;

    const result = await autoRegisterChannel('slack', 'C0AH4ASPAFP');

    expect(result).toEqual({
      id: MOCK_UUID,
      platform: 'slack',
      externalId: 'C0AH4ASPAFP',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(updateCalls.length).toBe(0);
  });
});
