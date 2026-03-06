import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { NotFoundError } from '../../errors/app-error';
import { ApprovalService } from '../approval.service';

const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';

const MOCK_POLICY = {
  id: 'policy-001',
  channelId: CHANNEL_ID,
  toolName: 'deploy_production',
  policy: 'ask',
  allowedUsers: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

let mockSelectRows: unknown[] = [];
let mockInsertedRows: unknown[] = [];
let mockUpdatedRows: unknown[] = [];
let mockDeletedRows: unknown[] = [];

mock.module('../../db', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => [...mockSelectRows],
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

describe('ApprovalService', () => {
  let service: ApprovalService;

  beforeEach(() => {
    service = new ApprovalService();
    mockSelectRows = [];
    mockInsertedRows = [];
    mockUpdatedRows = [];
    mockDeletedRows = [];
  });

  afterEach(() => {
    mockSelectRows = [];
    mockInsertedRows = [];
    mockUpdatedRows = [];
    mockDeletedRows = [];
  });

  describe('listByChannel', () => {
    test('returns policies for channel', async () => {
      mockSelectRows = [MOCK_POLICY];
      const result = await service.listByChannel(CHANNEL_ID);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(MOCK_POLICY);
    });

    test('returns empty when no policies', async () => {
      mockSelectRows = [];
      const result = await service.listByChannel(CHANNEL_ID);
      expect(result).toHaveLength(0);
    });
  });

  describe('create', () => {
    test('creates approval policy', async () => {
      mockInsertedRows = [MOCK_POLICY];
      const result = await service.create({
        channelId: CHANNEL_ID,
        toolName: 'deploy_production',
      });
      expect(result).toEqual(MOCK_POLICY);
    });
  });

  describe('update', () => {
    test('updates policy', async () => {
      mockUpdatedRows = [{ ...MOCK_POLICY, policy: 'auto' }];
      const result = await service.update('policy-001', { policy: 'auto' });
      expect(result.policy).toBe('auto');
    });

    test('throws NotFoundError when not found', async () => {
      mockUpdatedRows = [];
      expect(service.update('nonexistent', { policy: 'auto' })).rejects.toThrow(NotFoundError);
    });
  });

  describe('delete', () => {
    test('deletes policy', async () => {
      mockDeletedRows = [MOCK_POLICY];
      await service.delete('policy-001');
    });

    test('throws NotFoundError when not found', async () => {
      mockDeletedRows = [];
      expect(service.delete('nonexistent')).rejects.toThrow(NotFoundError);
    });
  });
});
