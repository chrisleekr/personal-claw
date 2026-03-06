import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { NotFoundError } from '../../errors/app-error';
import { SkillService } from '../skill.service';

const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';

const MOCK_SKILL = {
  id: 'skill-001',
  channelId: CHANNEL_ID,
  name: 'Deploy Helper',
  content: 'Helps with deployments',
  allowedTools: [],
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

let mockSelectRows: unknown[] = [];
let mockInsertedRows: unknown[] = [];
let mockUpdatedRows: unknown[] = [];
let mockDeletedRows: unknown[] = [];
let configChanges: Array<{ channelId: string; changeType: string }> = [];

mock.module('../../db', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => [...mockSelectRows],
          groupBy: () => [...mockSelectRows],
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => [...mockInsertedRows],
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => [...mockUpdatedRows],
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: () => [...mockDeletedRows],
      }),
    }),
  }),
}));

mock.module('../../config/hot-reload', () => ({
  emitConfigChange: (channelId: string, changeType: string) => {
    configChanges.push({ channelId, changeType });
  },
}));

describe('SkillService', () => {
  let service: SkillService;

  beforeEach(() => {
    service = new SkillService();
    mockSelectRows = [];
    mockInsertedRows = [];
    mockUpdatedRows = [];
    mockDeletedRows = [];
    configChanges = [];
  });

  afterEach(() => {
    mockSelectRows = [];
    mockInsertedRows = [];
    mockUpdatedRows = [];
    mockDeletedRows = [];
    configChanges = [];
  });

  describe('listByChannel', () => {
    test('returns skills for channel', async () => {
      mockSelectRows = [MOCK_SKILL];
      const result = await service.listByChannel(CHANNEL_ID);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(MOCK_SKILL);
    });
  });

  describe('getStats', () => {
    test('returns usage stats', async () => {
      const stats = [{ skillId: 'skill-001', usageCount: 42 }];
      mockSelectRows = stats;
      const result = await service.getStats(CHANNEL_ID);
      expect(result).toEqual(stats);
    });
  });

  describe('create', () => {
    test('creates skill and emits config change', async () => {
      mockInsertedRows = [MOCK_SKILL];
      const result = await service.create({
        channelId: CHANNEL_ID,
        name: 'Deploy Helper',
        content: 'Helps with deployments',
      });
      expect(result).toEqual(MOCK_SKILL);
      expect(configChanges).toHaveLength(1);
      expect(configChanges[0]).toEqual({ channelId: CHANNEL_ID, changeType: 'skills' });
    });
  });

  describe('update', () => {
    test('updates skill and emits config change', async () => {
      mockUpdatedRows = [{ ...MOCK_SKILL, name: 'Updated Name' }];
      const result = await service.update('skill-001', { name: 'Updated Name' });
      expect(result.name).toBe('Updated Name');
      expect(configChanges).toHaveLength(1);
    });

    test('throws NotFoundError when not found', async () => {
      mockUpdatedRows = [];
      expect(service.update('nonexistent', { name: 'x' })).rejects.toThrow(NotFoundError);
    });
  });

  describe('delete', () => {
    test('deletes skill and emits config change', async () => {
      mockDeletedRows = [MOCK_SKILL];
      await service.delete('skill-001');
      expect(configChanges).toHaveLength(1);
    });

    test('throws NotFoundError when not found', async () => {
      mockDeletedRows = [];
      expect(service.delete('nonexistent')).rejects.toThrow(NotFoundError);
    });
  });
});
