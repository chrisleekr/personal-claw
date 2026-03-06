import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { NotFoundError } from '../../errors/app-error';

const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';

const MOCK_CONVERSATION = {
  id: 'conv-001',
  channelId: CHANNEL_ID,
  externalThreadId: 'thread-123',
  messages: [{ role: 'user', content: 'Hello' }],
  summary: null,
  isCompacted: false,
  tokenCount: 10,
  createdAt: new Date(),
  updatedAt: new Date(),
};

let mockSelectRows: unknown[] = [];

function chainable(getRows: () => unknown[]): unknown {
  const methods: Record<string, unknown> = {};
  for (const name of ['from', 'where', 'orderBy', 'limit', 'groupBy', 'returning', 'as']) {
    methods[name] = () => chainable(getRows);
  }
  return Object.assign([...getRows()], methods);
}

mock.module('../../db', () => ({
  getDb: () => ({
    select: () => chainable(() => mockSelectRows),
  }),
}));

import { ConversationService } from '../conversation.service';

describe('ConversationService', () => {
  let service: ConversationService;

  beforeEach(() => {
    service = new ConversationService();
    mockSelectRows = [];
  });

  afterEach(() => {
    mockSelectRows = [];
  });

  describe('listByChannel', () => {
    test('returns conversations for channel', async () => {
      mockSelectRows = [MOCK_CONVERSATION];
      const result = await service.listByChannel(CHANNEL_ID);
      expect(result).toHaveLength(1);
    });

    test('returns empty array when no conversations', async () => {
      mockSelectRows = [];
      const result = await service.listByChannel(CHANNEL_ID);
      expect(result).toHaveLength(0);
    });
  });

  describe('getById', () => {
    test('returns conversation when found and channel matches', async () => {
      mockSelectRows = [MOCK_CONVERSATION];
      const result = await service.getById(CHANNEL_ID, 'conv-001');
      expect(result.id).toBe('conv-001');
      expect(result.channelId).toBe(CHANNEL_ID);
    });

    test('throws NotFoundError when not found', async () => {
      mockSelectRows = [];
      expect(service.getById(CHANNEL_ID, 'nonexistent')).rejects.toBeInstanceOf(NotFoundError);
    });

    test('throws NotFoundError when channel does not match (isolation)', async () => {
      mockSelectRows = [{ ...MOCK_CONVERSATION, channelId: 'other-channel' }];
      expect(service.getById(CHANNEL_ID, 'conv-001')).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
