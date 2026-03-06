import { beforeEach, describe, expect, mock, test } from 'bun:test';

const mockMessage = mock(() => {});
const mockEvent = mock(() => {});
const mockAction = mock(() => {});
const mockStart = mock(async () => {});

let appConstructorArgs: unknown[] = [];

class MockApp {
  message = mockMessage;
  event = mockEvent;
  action = mockAction;
  start = mockStart;

  constructor(...args: unknown[]) {
    appConstructorArgs = args;
  }
}

mock.module('@slack/bolt', () => ({
  App: MockApp,
  LogLevel: { INFO: 'info' },
}));

mock.module('../../../config', () => ({
  config: {
    SLACK_BOT_TOKEN: 'xoxb-test-token',
    SLACK_APP_TOKEN: 'xapp-test-token',
    SLACK_BOT_USER_ID: 'U_BOT',
  },
}));

mock.module('../../../channels/auto-register', () => ({
  autoRegisterChannel: mock(async () => ({ id: 'ch-auto' })),
}));

class MockChannelNotFoundError extends Error {}

mock.module('../../../channels/resolver', () => ({
  ChannelNotFoundError: MockChannelNotFoundError,
  _ChannelResolver: {
    getInstance: () => ({
      resolve: mock(async () => ({ id: 'ch-resolved' })),
    }),
  },
}));

mock.module('../approvals', () => ({
  dismissPendingApprovals: mock(async () => {}),
  handleApprovalAction: mock(async () => {}),
}));

mock.module('../feedback', () => ({
  classifyReaction: mock(() => null),
  handleReactionFeedback: mock(async () => {}),
}));

mock.module('../handlers', () => ({
  handleMessage: mock(async () => {}),
}));

mock.module('../media', () => ({
  extractImageRefs: mock(() => []),
  downloadImages: mock(async () => []),
}));

mock.module('../slash-commands', () => ({
  handleSlashCommand: mock(async () => {}),
}));

import { getSlackApp, initSlackBot } from '../bolt';

describe('initSlackBot', () => {
  beforeEach(() => {
    appConstructorArgs = [];
    mockMessage.mockClear();
    mockEvent.mockClear();
    mockAction.mockClear();
    mockStart.mockClear();
  });

  test('creates App with correct options', async () => {
    await initSlackBot();

    const opts = appConstructorArgs[0] as Record<string, unknown>;
    expect(opts.token).toBe('xoxb-test-token');
    expect(opts.appToken).toBe('xapp-test-token');
    expect(opts.socketMode).toBe(true);
  });

  test('registers message handler', async () => {
    await initSlackBot();
    expect(mockMessage).toHaveBeenCalledTimes(1);
    expect(typeof mockMessage.mock.calls[0][0]).toBe('function');
  });

  test('registers app_mention event handler', async () => {
    await initSlackBot();
    const mentionCalls = mockEvent.mock.calls.filter(
      (call: unknown[]) => call[0] === 'app_mention',
    );
    expect(mentionCalls.length).toBe(1);
  });

  test('registers approval action handlers', async () => {
    await initSlackBot();
    const actionCalls = mockAction.mock.calls;
    expect(actionCalls.length).toBe(3);

    const patterns = actionCalls.map((call: unknown[]) => String(call[0]));
    expect(patterns).toContain('/^approval_/');
    expect(patterns).toContain('/^plan_/');
    expect(patterns).toContain('/^batch_/');
  });

  test('registers reaction_added event handler', async () => {
    await initSlackBot();
    const reactionCalls = mockEvent.mock.calls.filter(
      (call: unknown[]) => call[0] === 'reaction_added',
    );
    expect(reactionCalls.length).toBe(1);
  });

  test('calls start to connect', async () => {
    await initSlackBot();
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  test('getSlackApp returns the app after init', async () => {
    await initSlackBot();
    const app = getSlackApp();
    expect(app).not.toBeNull();
    expect(typeof (app as Record<string, unknown>).message).toBe('function');
  });
});

describe('initSlackBot without tokens', () => {
  test('skips init when tokens are missing', async () => {
    const configModule = await import('../../../config');
    const originalToken = configModule.config.SLACK_BOT_TOKEN;
    const originalAppToken = configModule.config.SLACK_APP_TOKEN;

    (configModule.config as Record<string, unknown>).SLACK_BOT_TOKEN = '';
    (configModule.config as Record<string, unknown>).SLACK_APP_TOKEN = '';

    mockStart.mockClear();

    await initSlackBot();

    expect(mockStart).not.toHaveBeenCalled();

    (configModule.config as Record<string, unknown>).SLACK_BOT_TOKEN = originalToken;
    (configModule.config as Record<string, unknown>).SLACK_APP_TOKEN = originalAppToken;
  });
});
