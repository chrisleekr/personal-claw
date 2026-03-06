import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { NotFoundError } from '../../errors/app-error';
import { MemoryService } from '../memory.service';

const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';

const MOCK_MEMORY = {
  id: 'mem-001',
  channelId: CHANNEL_ID,
  content: 'User prefers dark mode',
  category: 'preference',
  recallCount: 5,
  createdAt: new Date(),
  updatedAt: new Date(),
};

let mockSelectRows: unknown[] = [];
let mockUpdatedRows: unknown[] = [];
let mockDeletedRows: unknown[] = [];

mock.module('../../db', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => [...mockSelectRows],
          }),
        }),
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

describe('MemoryService', () => {
  let service: MemoryService;

  beforeEach(() => {
    service = new MemoryService();
    mockSelectRows = [];
    mockUpdatedRows = [];
    mockDeletedRows = [];
  });

  afterEach(() => {
    mockSelectRows = [];
    mockUpdatedRows = [];
    mockDeletedRows = [];
  });

  describe('listByChannel', () => {
    test('returns memories for channel', async () => {
      mockSelectRows = [MOCK_MEMORY];
      const result = await service.listByChannel(CHANNEL_ID);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(MOCK_MEMORY);
    });

    test('returns empty array when none', async () => {
      mockSelectRows = [];
      const result = await service.listByChannel(CHANNEL_ID);
      expect(result).toHaveLength(0);
    });
  });

  describe('search', () => {
    test('falls back to listByChannel when query is empty', async () => {
      mockSelectRows = [MOCK_MEMORY];
      const result = await service.search(CHANNEL_ID, '');
      expect(result).toHaveLength(1);
    });

    test('filters results by case-insensitive query', async () => {
      mockSelectRows = [
        MOCK_MEMORY,
        { ...MOCK_MEMORY, id: 'mem-002', content: 'Deployed to production' },
      ];
      const result = await service.search(CHANNEL_ID, 'dark mode');
      expect(result).toHaveLength(1);
      expect(result[0].content).toContain('dark mode');
    });

    test('returns empty when no matches', async () => {
      mockSelectRows = [MOCK_MEMORY];
      const result = await service.search(CHANNEL_ID, 'nonexistent term');
      expect(result).toHaveLength(0);
    });
  });

  describe('update', () => {
    test('returns updated memory', async () => {
      mockUpdatedRows = [{ ...MOCK_MEMORY, content: 'Updated content' }];
      const result = await service.update('mem-001', { content: 'Updated content' });
      expect(result.content).toBe('Updated content');
    });

    test('throws NotFoundError when not found', async () => {
      mockUpdatedRows = [];
      expect(service.update('nonexistent', { content: 'x' })).rejects.toThrow(NotFoundError);
    });
  });

  describe('delete', () => {
    test('deletes memory successfully', async () => {
      mockDeletedRows = [MOCK_MEMORY];
      await service.delete('mem-001');
    });

    test('throws NotFoundError when not found', async () => {
      mockDeletedRows = [];
      expect(service.delete('nonexistent')).rejects.toThrow(NotFoundError);
    });
  });
});
