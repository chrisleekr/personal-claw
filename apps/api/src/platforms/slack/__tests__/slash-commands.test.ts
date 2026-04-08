import { beforeEach, describe, expect, mock, test } from 'bun:test';

const mockResolve = mock(async () => ({ id: 'resolved-ch-1' }));

mock.module('../../../channels/resolver', () => ({
  ChannelNotFoundError: class extends Error {},
  ChannelResolver: {
    getInstance: () => ({ resolve: mockResolve }),
  },
}));

mock.module('../../../channels/auto-register', () => ({
  autoRegisterChannel: mock(async () => ({ id: 'auto-ch-1' })),
}));

const mockDbSelect = mock(() => {
  const state = { table: null as unknown, whereVal: null as unknown };
  const chain = {
    from: mock((table: unknown) => {
      state.table = table;
      return chain;
    }),
    where: mock(() => []),
  };
  return chain;
});

const mockDbUpdate = mock(() => ({
  set: mock(() => ({
    where: mock(async () => {}),
  })),
}));

mock.module('../../../db', () => ({
  getDb: () => ({
    select: mockDbSelect,
    update: mockDbUpdate,
  }),
}));

mock.module('../../../config', () => ({
  config: {
    AUTH_URL: 'https://dashboard.example.com',
    SLACK_BOT_USER_ID: 'U_BOT',
  },
}));

mock.module('../../../agent/pricing', () => ({
  listRegisteredModels: mock(() => ['claude-sonnet-4-20250514', 'gpt-4o']),
}));

const mockTriggerCompaction = mock(async () => {});
mock.module('../../../memory/engine', () => ({
  MemoryEngine: class {
    triggerCompaction = mockTriggerCompaction;
  },
}));

mock.module('../../../utils/error-fmt', () => ({
  errorDetails: () => ({}),
}));

import { handleSlashCommand, type SlashCommandParams } from '../slash-commands';

function makeSay() {
  return mock(async () => ({})) as unknown as import('@slack/bolt').SayFn;
}

function makeParams(text: string, overrides: Partial<SlashCommandParams> = {}): SlashCommandParams {
  return {
    text,
    threadTs: 'T_THREAD',
    channelId: 'C_SLACK',
    userId: 'U_TEST_USER',
    say: makeSay(),
    ...overrides,
  };
}

describe('handleSlashCommand', () => {
  beforeEach(() => {
    mockResolve.mockClear();
    mockDbSelect.mockClear();
    mockDbUpdate.mockClear();
    mockTriggerCompaction.mockClear();
  });

  test('help command lists available commands', async () => {
    const params = makeParams('/pclaw help');
    await handleSlashCommand(params);

    expect(params.say).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Available commands'),
        thread_ts: 'T_THREAD',
      }),
    );
  });

  test('help command does not resolve channel', async () => {
    const params = makeParams('/pclaw help');
    await handleSlashCommand(params);

    expect(mockResolve).not.toHaveBeenCalled();
  });

  test('status command resolves channel and queries db', async () => {
    mockDbSelect.mockImplementation(() => {
      const chain = {
        from: mock(() => chain),
        where: mock(() => [{ model: 'claude-sonnet-4-20250514', provider: 'anthropic', count: 5 }]),
      };
      return chain;
    });

    const params = makeParams('/pclaw status');
    await handleSlashCommand(params);

    expect(mockResolve).toHaveBeenCalled();
    expect(params.say).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Channel status'),
      }),
    );
  });

  test('model command with no arg shows current model', async () => {
    mockDbSelect.mockImplementation(() => {
      const chain = {
        from: mock(() => chain),
        where: mock(() => [{ model: 'gpt-4o' }]),
      };
      return chain;
    });

    const params = makeParams('/pclaw model');
    await handleSlashCommand(params);

    expect(params.say).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Current model'),
      }),
    );
  });

  test('model command with unknown model warns user', async () => {
    const params = makeParams('/pclaw model unknown-model');
    await handleSlashCommand(params);

    expect(params.say).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Unknown model'),
      }),
    );
  });

  test('model command with valid model updates db', async () => {
    const params = makeParams('/pclaw model gpt-4o');
    await handleSlashCommand(params);

    expect(mockDbUpdate).toHaveBeenCalled();
    expect(params.say).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Model updated'),
      }),
    );
  });

  test('skills command with no skills shows empty message', async () => {
    mockDbSelect.mockImplementation(() => {
      const chain = {
        from: mock(() => chain),
        where: mock(() => []),
      };
      return chain;
    });

    const params = makeParams('/pclaw skills');
    await handleSlashCommand(params);

    expect(params.say).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('No skills configured'),
      }),
    );
  });

  test('memory command shows memory count', async () => {
    mockDbSelect.mockImplementation(() => {
      const chain = {
        from: mock(() => chain),
        where: mock(() => [{ count: 42 }]),
      };
      return chain;
    });

    const params = makeParams('/pclaw memory');
    await handleSlashCommand(params);

    expect(params.say).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Memory stats'),
      }),
    );
  });

  test('compact command triggers compaction', async () => {
    const say = makeSay();
    const params = makeParams('/pclaw compact', { say });
    await handleSlashCommand(params);

    expect(mockTriggerCompaction).toHaveBeenCalledWith('resolved-ch-1', 'T_THREAD');
    expect(say).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('compaction complete'),
      }),
    );
  });

  test('config command shows dashboard URL', async () => {
    const params = makeParams('/pclaw config');
    await handleSlashCommand(params);

    expect(params.say).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('https://dashboard.example.com'),
      }),
    );
  });

  test('unknown command shows error', async () => {
    const params = makeParams('/pclaw foobar');
    await handleSlashCommand(params);

    expect(params.say).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Unknown command'),
        thread_ts: 'T_THREAD',
      }),
    );
  });
});
