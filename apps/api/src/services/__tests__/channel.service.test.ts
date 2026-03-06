import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { NotFoundError } from '../../errors/app-error';
import { ChannelService } from '../channel.service';

const MOCK_CHANNEL = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  platform: 'slack' as const,
  externalId: 'C12345',
  externalName: 'general',
  model: 'claude-sonnet-4-20250514',
  createdAt: new Date(),
  updatedAt: new Date(),
};

let mockSelectRows: unknown[] = [];
let mockInsertedRows: unknown[] = [];
let mockUpdatedRows: unknown[] = [];
let mockDeletedRows: unknown[] = [];
let invalidateCalled: string[] = [];

mock.module('../../db', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => [...mockSelectRows],
        orderBy: () => [...mockSelectRows],
      }),
    }),
    insert: () => ({
      values: (_input: unknown) => ({
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

mock.module('../../channels/config-cache', () => ({
  invalidateConfig: (id: string) => {
    invalidateCalled.push(id);
  },
}));

describe('ChannelService', () => {
  let service: ChannelService;

  beforeEach(() => {
    service = new ChannelService();
    mockSelectRows = [];
    mockInsertedRows = [];
    mockUpdatedRows = [];
    mockDeletedRows = [];
    invalidateCalled = [];
  });

  afterEach(() => {
    mockSelectRows = [];
    mockInsertedRows = [];
    mockUpdatedRows = [];
    mockDeletedRows = [];
    invalidateCalled = [];
  });

  describe('list', () => {
    test('returns all channels', async () => {
      mockSelectRows = [MOCK_CHANNEL];
      const result = await service.list();
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(MOCK_CHANNEL);
    });

    test('returns empty array when no channels', async () => {
      mockSelectRows = [];
      const result = await service.list();
      expect(result).toHaveLength(0);
    });
  });

  describe('getById', () => {
    test('returns channel when found', async () => {
      mockSelectRows = [MOCK_CHANNEL];
      const result = await service.getById(MOCK_CHANNEL.id);
      expect(result).toEqual(MOCK_CHANNEL);
    });

    test('throws NotFoundError when not found', async () => {
      mockSelectRows = [];
      expect(service.getById('nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('create', () => {
    test('returns created channel', async () => {
      mockInsertedRows = [MOCK_CHANNEL];
      const result = await service.create({
        externalId: 'C12345',
        platform: 'slack',
      });
      expect(result).toEqual(MOCK_CHANNEL);
    });
  });

  describe('update', () => {
    test('returns updated channel and invalidates cache', async () => {
      mockUpdatedRows = [{ ...MOCK_CHANNEL, model: 'gpt-4o' }];
      const result = await service.update(MOCK_CHANNEL.id, { model: 'gpt-4o' });
      expect(result.model).toBe('gpt-4o');
      expect(invalidateCalled).toContain(MOCK_CHANNEL.id);
    });

    test('throws NotFoundError when channel does not exist', async () => {
      mockUpdatedRows = [];
      expect(service.update('nonexistent', { model: 'gpt-4o' })).rejects.toThrow(NotFoundError);
    });
  });

  describe('delete', () => {
    test('deletes channel and invalidates cache', async () => {
      mockDeletedRows = [MOCK_CHANNEL];
      await service.delete(MOCK_CHANNEL.id);
      expect(invalidateCalled).toContain(MOCK_CHANNEL.id);
    });

    test('throws NotFoundError when channel does not exist', async () => {
      mockDeletedRows = [];
      expect(service.delete('nonexistent')).rejects.toThrow(NotFoundError);
    });
  });
});
