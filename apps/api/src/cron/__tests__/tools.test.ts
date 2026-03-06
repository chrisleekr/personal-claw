import { beforeEach, describe, expect, mock, test } from 'bun:test';

let mockSelectRows: unknown[] = [];
let mockInsertRows: unknown[] = [];
let mockUpdateRows: unknown[] = [];
let mockDeleteRows: unknown[] = [];

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
    insert: () => ({ values: () => chainable(() => mockInsertRows) }),
    update: () => ({ set: () => chainable(() => mockUpdateRows) }),
    delete: () => chainable(() => mockDeleteRows),
  }),
}));

mock.module('../../config/hot-reload', () => {
  const _handlers: Array<(channelId: string, changeType: string) => void> = [];
  return {
    onConfigChange: (h: (channelId: string, changeType: string) => void) => _handlers.push(h),
    emitConfigChange: (channelId: string, changeType: string) => {
      for (const h of _handlers) h(channelId, changeType);
    },
  };
});

import { getScheduleTools } from '../tools';

const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';
const toolCtx = {
  toolCallId: 'tc-1',
  messages: [] as never[],
  abortSignal: new AbortController().signal,
};

describe('getScheduleTools', () => {
  beforeEach(() => {
    mockSelectRows = [];
    mockInsertRows = [];
    mockUpdateRows = [];
    mockDeleteRows = [];
  });

  test('returns schedule_list, schedule_create, schedule_update, schedule_delete', () => {
    const tools = getScheduleTools(CHANNEL_ID);
    expect(tools.schedule_list).toBeDefined();
    expect(tools.schedule_create).toBeDefined();
    expect(tools.schedule_update).toBeDefined();
    expect(tools.schedule_delete).toBeDefined();
  });

  test('schedule_list returns schedules array', async () => {
    mockSelectRows = [
      {
        id: 's-1',
        name: 'Daily report',
        cronExpression: '0 9 * * 1-5',
        prompt: 'Generate report',
        enabled: true,
        lastRunAt: null,
      },
    ];
    const tools = getScheduleTools(CHANNEL_ID);
    const result = await tools.schedule_list.execute({}, toolCtx);
    expect((result as { schedules: unknown[] }).schedules).toHaveLength(1);
    expect((result as { schedules: Array<{ name: string }> }).schedules[0].name).toBe(
      'Daily report',
    );
  });

  test('schedule_create returns created schedule', async () => {
    mockInsertRows = [
      {
        id: 's-new',
        name: 'New task',
        cronExpression: '0 */6 * * *',
        prompt: 'Do something',
        enabled: true,
      },
    ];
    const tools = getScheduleTools(CHANNEL_ID);
    const result = await tools.schedule_create.execute(
      { name: 'New task', cronExpression: '0 */6 * * *', prompt: 'Do something', enabled: true },
      toolCtx,
    );
    expect((result as { created: boolean }).created).toBe(true);
  });

  test('schedule_delete returns error when not found', async () => {
    mockDeleteRows = [];
    const tools = getScheduleTools(CHANNEL_ID);
    const result = await tools.schedule_delete.execute(
      { id: '550e8400-e29b-41d4-a716-446655440001' },
      toolCtx,
    );
    expect((result as { error: boolean }).error).toBe(true);
  });
});
