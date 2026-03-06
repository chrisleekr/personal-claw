import { beforeEach, describe, expect, mock, test } from 'bun:test';

let mockScheduleRows: unknown[] = [];

function chainable(getRows: () => unknown[]): unknown {
  const methods: Record<string, unknown> = {};
  for (const name of ['from', 'where', 'orderBy', 'limit', 'groupBy', 'returning', 'set']) {
    methods[name] = () => chainable(getRows);
  }
  return Object.assign([...getRows()], methods);
}

mock.module('../../db', () => ({
  getDb: () => ({
    select: () => chainable(() => mockScheduleRows),
    update: () => ({
      set: () => chainable(() => []),
    }),
  }),
}));

const configChangeHandlers: Array<(channelId: string, changeType: string) => void> = [];

mock.module('../../config/hot-reload', () => ({
  onConfigChange: (h: (channelId: string, changeType: string) => void) => {
    configChangeHandlers.push(h);
  },
  emitConfigChange: (channelId: string, changeType: string) => {
    for (const h of configChangeHandlers) h(channelId, changeType);
  },
}));

mock.module('../../channels/adapter-factory', () => ({
  createChannelAdapter: () => ({
    sendMessage: mock(() => Promise.resolve()),
    formatMentions: mock((users: string[]) => users.map((u) => `<@${u}>`).join(' ')),
  }),
}));

mock.module('../../agent/engine', () => ({
  AgentEngine: {
    create: () => Promise.resolve({ run: () => Promise.resolve({ text: 'output' }) }),
  },
}));

mock.module('../../utils/error-fmt', () => ({
  errorDetails: (err: unknown) => ({ message: String(err) }),
}));

const mockCronValidate = mock(() => true);
const mockCronSchedule = mock((_expr: string, _cb: () => void) => {
  return { stop: mock(() => {}) };
});

mock.module('node-cron', () => ({
  default: {
    validate: mockCronValidate,
    schedule: mockCronSchedule,
  },
}));

import { initCronRunner } from '../runner';

const flush = () => new Promise<void>((r) => setTimeout(r, 10));

describe('initCronRunner', () => {
  beforeEach(() => {
    mockScheduleRows = [];
    mockCronValidate.mockClear();
    mockCronSchedule.mockClear();
    configChangeHandlers.length = 0;
  });

  test('loads and registers enabled schedules', async () => {
    mockScheduleRows = [
      {
        id: 's-1',
        name: 'Daily report',
        cronExpression: '0 9 * * 1-5',
        prompt: 'Generate report',
        channelId: 'ch-1',
        enabled: true,
        notifyUsers: [],
      },
    ];
    initCronRunner();
    await flush();
    expect(mockCronSchedule).toHaveBeenCalledTimes(1);
  });

  test('skips schedules with invalid cron expressions', async () => {
    mockCronValidate.mockReturnValueOnce(false);
    mockScheduleRows = [
      {
        id: 's-bad',
        name: 'Bad schedule',
        cronExpression: 'invalid',
        prompt: 'Test',
        channelId: 'ch-1',
        enabled: true,
        notifyUsers: [],
      },
    ];
    initCronRunner();
    await flush();
    expect(mockCronSchedule).not.toHaveBeenCalled();
  });

  test('registers onConfigChange handler for schedule reloads', () => {
    mockScheduleRows = [];
    initCronRunner();
    expect(configChangeHandlers.length).toBeGreaterThanOrEqual(1);
  });

  test('reloads schedules when config change type is "schedules"', async () => {
    mockScheduleRows = [];
    initCronRunner();
    await flush();
    const callsAfterInit = mockCronSchedule.mock.calls.length;

    mockScheduleRows = [
      {
        id: 's-2',
        name: 'New schedule',
        cronExpression: '0 12 * * *',
        prompt: 'Noon check',
        channelId: 'ch-2',
        enabled: true,
        notifyUsers: [],
      },
    ];
    for (const h of configChangeHandlers) h('ch-2', 'schedules');
    await flush();

    expect(mockCronSchedule.mock.calls.length).toBeGreaterThan(callsAfterInit);
  });

  test('does not reload for non-schedule config changes', async () => {
    mockScheduleRows = [];
    initCronRunner();
    await flush();
    const callsAfterInit = mockCronSchedule.mock.calls.length;

    for (const h of configChangeHandlers) h('ch-1', 'identity');
    await flush();
    expect(mockCronSchedule.mock.calls.length).toBe(callsAfterInit);
  });
});
