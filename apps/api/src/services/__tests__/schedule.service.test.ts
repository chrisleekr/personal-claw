import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { NotFoundError } from '../../errors/app-error';

const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';

const MOCK_SCHEDULE = {
  id: 'sched-001',
  channelId: CHANNEL_ID,
  name: 'Daily standup',
  cronExpression: '0 9 * * *',
  prompt: 'Summarize yesterday',
  enabled: true,
  notifyUsers: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

let mockSelectRows: unknown[] = [];
let mockInsertRows: unknown[] = [];
let mockUpdateRows: unknown[] = [];
let mockDeleteRows: unknown[] = [];

function chainable(getRows: () => unknown[]): unknown {
  const methods: Record<string, unknown> = {};
  for (const name of ['from', 'where', 'orderBy', 'limit', 'groupBy', 'returning']) {
    methods[name] = () => chainable(getRows);
  }
  return Object.assign([...getRows()], methods);
}

mock.module('../../db', () => ({
  getDb: () => ({
    select: () => chainable(() => mockSelectRows),
    insert: () => ({
      values: () => ({
        returning: () => [...mockInsertRows],
      }),
    }),
    update: () => ({
      set: () => chainable(() => mockUpdateRows),
    }),
    delete: () => chainable(() => mockDeleteRows),
  }),
}));

mock.module('../../config/hot-reload', () => ({
  emitConfigChange: () => {},
}));

import { ScheduleService, updateScheduleSchema } from '../schedule.service';

describe('ScheduleService', () => {
  let service: ScheduleService;

  beforeEach(() => {
    service = new ScheduleService();
    mockSelectRows = [];
    mockInsertRows = [];
    mockUpdateRows = [];
    mockDeleteRows = [];
  });

  afterEach(() => {
    mockSelectRows = [];
    mockInsertRows = [];
    mockUpdateRows = [];
    mockDeleteRows = [];
  });

  describe('listByChannel', () => {
    test('returns schedules for channel', async () => {
      mockSelectRows = [MOCK_SCHEDULE];
      const result = await service.listByChannel(CHANNEL_ID);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Daily standup');
    });

    test('returns empty array when no schedules', async () => {
      mockSelectRows = [];
      const result = await service.listByChannel(CHANNEL_ID);
      expect(result).toHaveLength(0);
    });
  });

  describe('create', () => {
    test('creates and returns new schedule', async () => {
      mockInsertRows = [MOCK_SCHEDULE];
      const result = await service.create({
        channelId: CHANNEL_ID,
        name: 'Daily standup',
        cronExpression: '0 9 * * *',
        prompt: 'Summarize yesterday',
      });
      expect(result.name).toBe('Daily standup');
    });
  });

  describe('update', () => {
    test('updates and returns schedule', async () => {
      mockUpdateRows = [{ ...MOCK_SCHEDULE, name: 'Weekly review' }];
      const result = await service.update('sched-001', { name: 'Weekly review' });
      expect(result.name).toBe('Weekly review');
    });

    test('throws NotFoundError when schedule not found', async () => {
      mockUpdateRows = [];
      expect(service.update('nonexistent', { name: 'test' })).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('delete', () => {
    test('deletes schedule successfully', async () => {
      mockDeleteRows = [MOCK_SCHEDULE];
      await expect(service.delete('sched-001')).resolves.toBeUndefined();
    });

    test('throws NotFoundError when schedule not found', async () => {
      mockDeleteRows = [];
      expect(service.delete('nonexistent')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('updateScheduleSchema', () => {
    test('accepts valid partial update', () => {
      const result = updateScheduleSchema.parse({ name: 'New name' });
      expect(result.name).toBe('New name');
    });

    test('accepts empty object', () => {
      const result = updateScheduleSchema.parse({});
      expect(result).toBeDefined();
    });

    test('rejects empty name', () => {
      expect(() => updateScheduleSchema.parse({ name: '' })).toThrow();
    });

    test('rejects empty cronExpression', () => {
      expect(() => updateScheduleSchema.parse({ cronExpression: '' })).toThrow();
    });

    test('accepts boolean enabled', () => {
      const result = updateScheduleSchema.parse({ enabled: false });
      expect(result.enabled).toBe(false);
    });

    test('accepts notifyUsers array', () => {
      const result = updateScheduleSchema.parse({ notifyUsers: ['U123', 'U456'] });
      expect(result.notifyUsers).toEqual(['U123', 'U456']);
    });
  });
});
