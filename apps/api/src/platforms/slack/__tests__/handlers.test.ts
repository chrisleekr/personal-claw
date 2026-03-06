import { beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('../../../agent/cost-tracker', () => ({
  CostTracker: () => ({
    isBudgetExceeded: async () => ({ exceeded: false, todaySpend: 0, budget: null }),
    log: async () => {},
  }),
}));

const mockEngineRun = mock(async () => ({
  text: 'bot reply',
  provider: 'mock',
  model: 'mock-model',
  usage: { inputTokens: 10, outputTokens: 20 },
  durationMs: 100,
  toolSequence: [],
  skillIds: [],
}));
mock.module('../../../agent/engine', () => ({
  AgentEngine: {
    create: async () => ({ run: mockEngineRun }),
  },
}));

const mockHooksEmit = mock(async () => {});
mock.module('../../../hooks/engine', () => ({
  HooksEngine: {
    getInstance: () => ({ emit: mockHooksEmit }),
  },
}));

mock.module('../../../redis', () => ({
  isRedisAvailable: () => false,
  getRedis: () => null,
}));

const mockResolve = mock(async () => ({ id: 'resolved-ch-1' }));
mock.module('../../../channels/resolver', () => ({
  ChannelNotFoundError: class ChannelNotFoundError extends Error {
    constructor() {
      super('not found');
    }
  },
  ChannelResolver: {
    getInstance: () => ({ resolve: mockResolve }),
  },
}));

mock.module('../../../channels/auto-register', () => ({
  autoRegisterChannel: mock(async () => ({ id: 'auto-ch-1' })),
}));

const mockGetCachedConfig = mock(async () => null);
mock.module('../../../channels/config-cache', () => ({
  getCachedConfig: mockGetCachedConfig,
}));

const mockCheckRateLimit = mock(async () => ({ allowed: true }));
mock.module('../../../middleware/rate-limiter', () => ({
  checkRateLimit: mockCheckRateLimit,
}));

mock.module('../../../config', () => ({
  config: { SLACK_BOT_USER_ID: 'U_BOT' },
}));

mock.module('../../../utils/error-fmt', () => ({
  errorDetails: () => ({}),
}));

const mockAdapterSendMessage = mock(async () => {});
mock.module('../adapter', () => ({
  SlackAdapter: class {
    sendMessage = mockAdapterSendMessage;
    constructor(
      public channelId: string,
      public say: unknown,
    ) {}
  },
}));

const mockWithThreadLock = mock(async (_id: string, fn: () => Promise<void>) => fn());
mock.module('../thread-lock', () => ({
  withThreadLock: mockWithThreadLock,
}));

mock.module('../approvals', () => ({
  ApprovalDismissedError: class extends Error {},
}));

mock.module('ai', () => ({
  APICallError: { isInstance: () => false },
}));

import { type HandleMessageParams, handleMessage } from '../handlers';

function makeParams(overrides: Partial<HandleMessageParams> = {}): HandleMessageParams {
  return {
    channelId: 'C_SLACK',
    threadId: 'T_THREAD',
    userId: 'U_USER',
    text: 'Hello bot',
    messageTs: '1234.5678',
    isMention: false,
    say: mock(async () => ({})) as unknown as import('@slack/bolt').SayFn,
    client: {
      reactions: {
        add: mock(async () => ({})),
        remove: mock(async () => ({})),
      },
      conversations: {
        replies: mock(async () => ({ messages: [] })),
      },
    },
    ...overrides,
  };
}

describe('handleMessage', () => {
  beforeEach(() => {
    mockEngineRun.mockClear();
    mockHooksEmit.mockClear();
    mockAdapterSendMessage.mockClear();
    mockResolve.mockClear();
    mockCheckRateLimit.mockClear();
    mockGetCachedConfig.mockClear();
    mockWithThreadLock.mockClear();

    mockCheckRateLimit.mockImplementation(async () => ({ allowed: true }));
    mockGetCachedConfig.mockImplementation(async () => null);
    mockEngineRun.mockImplementation(async () => ({
      text: 'bot reply',
      provider: 'mock',
      model: 'mock-model',
      usage: { inputTokens: 10, outputTokens: 20 },
      durationMs: 100,
      toolSequence: [],
      skillIds: [],
    }));
  });

  test('resolves channel and runs engine', async () => {
    const params = makeParams();
    await handleMessage(params);

    expect(mockResolve).toHaveBeenCalledWith('slack', 'C_SLACK');
    expect(mockEngineRun).toHaveBeenCalledTimes(1);
  });

  test('adds and removes reaction around processing', async () => {
    const params = makeParams();
    await handleMessage(params);

    expect(params.client.reactions.add).toHaveBeenCalledWith({
      channel: 'C_SLACK',
      timestamp: '1234.5678',
      name: 'hourglass_flowing_sand',
    });
    expect(params.client.reactions.remove).toHaveBeenCalledWith({
      channel: 'C_SLACK',
      timestamp: '1234.5678',
      name: 'hourglass_flowing_sand',
    });
  });

  test('acquires thread lock', async () => {
    const params = makeParams();
    await handleMessage(params);

    expect(mockWithThreadLock).toHaveBeenCalledTimes(1);
    expect(mockWithThreadLock.mock.calls[0][0]).toBe('T_THREAD');
  });

  test('blocks rate-limited users', async () => {
    mockCheckRateLimit.mockImplementation(async () => ({
      allowed: false,
      retryAfterSeconds: 30,
    }));

    const params = makeParams();
    await handleMessage(params);

    expect(mockEngineRun).not.toHaveBeenCalled();
    expect(params.say).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('too quickly'),
        thread_ts: 'T_THREAD',
      }),
    );
  });

  test('skips non-mention message when threadReplyMode is mentions_only', async () => {
    mockGetCachedConfig.mockImplementation(async () => ({
      threadReplyMode: 'mentions_only',
    }));

    const params = makeParams({ isMention: false, text: 'no mention here' });
    await handleMessage(params);

    expect(mockEngineRun).not.toHaveBeenCalled();
  });

  test('processes mention even when threadReplyMode is mentions_only', async () => {
    mockGetCachedConfig.mockImplementation(async () => ({
      threadReplyMode: 'mentions_only',
    }));

    const params = makeParams({ isMention: true, text: 'hey bot' });
    await handleMessage(params);

    expect(mockEngineRun).toHaveBeenCalledTimes(1);
  });

  test('sends error message on unhandled error', async () => {
    mockEngineRun.mockImplementation(async () => {
      throw new Error('unexpected boom');
    });

    const params = makeParams();
    await handleMessage(params);

    expect(params.say).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Something went wrong'),
        thread_ts: 'T_THREAD',
      }),
    );
  });

  test('removes reaction even on error', async () => {
    mockEngineRun.mockImplementation(async () => {
      throw new Error('boom');
    });

    const params = makeParams();
    await handleMessage(params);

    expect(params.client.reactions.remove).toHaveBeenCalled();
  });
});
