import { beforeEach, describe, expect, mock, test } from 'bun:test';

let mockSelectRows: unknown[] = [];
const mockSendMessage = mock(() => Promise.resolve());

function chainable(getRows: () => unknown[]): unknown {
  const methods: Record<string, unknown> = {};
  for (const name of ['from', 'where', 'orderBy', 'limit', 'groupBy', 'returning', 'set']) {
    methods[name] = () => chainable(getRows);
  }
  return Object.assign([...getRows()], methods);
}

mock.module('../../db', () => ({
  getDb: () => ({
    select: () => chainable(() => mockSelectRows),
  }),
}));

mock.module('../../channels/adapter-factory', () => ({
  createChannelAdapter: () => ({
    sendMessage: mockSendMessage,
  }),
}));

const mockEngineRun = mock(() => Promise.resolve({ text: 'heartbeat reply' }));

mock.module('../../agent/engine', () => ({
  AgentEngine: {
    create: () => Promise.resolve({ run: mockEngineRun }),
  },
}));

mock.module('../../utils/error-fmt', () => ({
  errorDetails: (err: unknown) => ({ message: String(err) }),
}));

const mockCronValidate = mock(() => true);
const mockCronSchedule = mock((_expr: string, cb: () => void) => {
  return { stop: mock(() => {}), callback: cb };
});

mock.module('node-cron', () => ({
  default: {
    validate: mockCronValidate,
    schedule: mockCronSchedule,
  },
}));

import { initHeartbeats, runHeartbeat } from '../heartbeat';

describe('runHeartbeat', () => {
  beforeEach(() => {
    mockSelectRows = [];
    mockSendMessage.mockClear();
    mockEngineRun.mockClear();
  });

  test('does nothing when channel is not found', async () => {
    mockSelectRows = [];
    await runHeartbeat('ch-missing');
    expect(mockEngineRun).not.toHaveBeenCalled();
  });

  test('does nothing when heartbeat is disabled', async () => {
    mockSelectRows = [
      {
        id: 'ch-1',
        platform: 'slack',
        externalId: 'C123',
        heartbeatPrompt: 'Check in',
        heartbeatEnabled: false,
      },
    ];
    await runHeartbeat('ch-1');
    expect(mockEngineRun).not.toHaveBeenCalled();
  });

  test('does nothing when heartbeatPrompt is null', async () => {
    mockSelectRows = [
      {
        id: 'ch-1',
        platform: 'slack',
        externalId: 'C123',
        heartbeatPrompt: null,
        heartbeatEnabled: true,
      },
    ];
    await runHeartbeat('ch-1');
    expect(mockEngineRun).not.toHaveBeenCalled();
  });

  test('runs agent and sends message when heartbeat is enabled', async () => {
    mockSelectRows = [
      {
        id: 'ch-1',
        platform: 'slack',
        externalId: 'C123',
        heartbeatPrompt: 'Daily check-in',
        heartbeatEnabled: true,
      },
    ];
    await runHeartbeat('ch-1');
    expect(mockEngineRun).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  test('does not send message when agent returns empty text', async () => {
    mockSelectRows = [
      {
        id: 'ch-1',
        platform: 'slack',
        externalId: 'C123',
        heartbeatPrompt: 'Daily check-in',
        heartbeatEnabled: true,
      },
    ];
    mockEngineRun.mockResolvedValueOnce({ text: '' });
    await runHeartbeat('ch-1');
    expect(mockEngineRun).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  test('does not throw when agent engine throws', async () => {
    mockSelectRows = [
      {
        id: 'ch-1',
        platform: 'slack',
        externalId: 'C123',
        heartbeatPrompt: 'Check in',
        heartbeatEnabled: true,
      },
    ];
    mockEngineRun.mockRejectedValueOnce(new Error('engine failure'));
    await expect(runHeartbeat('ch-1')).resolves.toBeUndefined();
  });
});

describe('initHeartbeats', () => {
  beforeEach(() => {
    mockSelectRows = [];
    mockCronValidate.mockClear();
    mockCronSchedule.mockClear();
  });

  test('registers tasks for enabled channels with valid cron', async () => {
    mockSelectRows = [
      { id: 'ch-1', heartbeatCron: '0 */2 * * *', heartbeatEnabled: true },
      { id: 'ch-2', heartbeatCron: '0 9 * * 1-5', heartbeatEnabled: true },
    ];
    await initHeartbeats();
    expect(mockCronSchedule).toHaveBeenCalledTimes(2);
  });

  test('skips channels with invalid cron expressions', async () => {
    mockCronValidate.mockReturnValueOnce(false);
    mockSelectRows = [{ id: 'ch-bad', heartbeatCron: 'not-valid', heartbeatEnabled: true }];
    await initHeartbeats();
    expect(mockCronSchedule).not.toHaveBeenCalled();
  });

  test('stops existing tasks before re-registering', async () => {
    const stopFn = mock(() => {});
    mockCronSchedule.mockReturnValueOnce({ stop: stopFn });
    mockSelectRows = [{ id: 'ch-1', heartbeatCron: '0 */2 * * *', heartbeatEnabled: true }];
    await initHeartbeats();

    mockSelectRows = [];
    await initHeartbeats();
    expect(stopFn).toHaveBeenCalled();
  });

  test('does not throw when db query fails', async () => {
    mock.module('../../db', () => ({
      getDb: () => ({
        select: () => {
          throw new Error('db down');
        },
      }),
    }));
    await expect(initHeartbeats()).resolves.toBeUndefined();
  });
});
