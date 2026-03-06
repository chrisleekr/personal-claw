import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { NotFoundError } from '../../errors/app-error';

const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';

const MOCK_IDENTITY = {
  identityPrompt: 'You are HelperBot.',
  teamPrompt: 'We use TypeScript.',
  threadReplyMode: 'all',
  autonomyLevel: 'balanced',
};

let mockSelectRows: unknown[] = [];
let mockUpdateRows: unknown[] = [];

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
    update: () => ({
      set: () => chainable(() => mockUpdateRows),
    }),
  }),
}));

mock.module('../../config/hot-reload', () => ({
  emitConfigChange: () => {},
}));

import { IdentityService, updateIdentitySchema } from '../identity.service';

describe('IdentityService', () => {
  let service: IdentityService;

  beforeEach(() => {
    service = new IdentityService();
    mockSelectRows = [];
    mockUpdateRows = [];
  });

  afterEach(() => {
    mockSelectRows = [];
    mockUpdateRows = [];
  });

  describe('getByChannel', () => {
    test('returns identity when channel exists', async () => {
      mockSelectRows = [MOCK_IDENTITY];
      const result = await service.getByChannel(CHANNEL_ID);
      expect(result.identityPrompt).toBe('You are HelperBot.');
      expect(result.autonomyLevel).toBe('balanced');
    });

    test('throws NotFoundError when channel not found', async () => {
      mockSelectRows = [];
      expect(service.getByChannel('nonexistent')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('update', () => {
    test('updates and returns identity', async () => {
      mockUpdateRows = [{ ...MOCK_IDENTITY, identityPrompt: 'Updated bot.' }];
      const result = await service.update(CHANNEL_ID, { identityPrompt: 'Updated bot.' });
      expect(result.identityPrompt).toBe('Updated bot.');
    });

    test('throws NotFoundError when channel not found', async () => {
      mockUpdateRows = [];
      expect(service.update('nonexistent', { identityPrompt: 'test' })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  describe('updateIdentitySchema', () => {
    test('accepts valid partial update', () => {
      const result = updateIdentitySchema.parse({ identityPrompt: 'New prompt' });
      expect(result.identityPrompt).toBe('New prompt');
      expect(result.teamPrompt).toBeUndefined();
    });

    test('accepts all valid fields', () => {
      const result = updateIdentitySchema.parse({
        identityPrompt: 'Bot',
        teamPrompt: 'Team',
        threadReplyMode: 'mentions_only',
        autonomyLevel: 'cautious',
      });
      expect(result.threadReplyMode).toBe('mentions_only');
      expect(result.autonomyLevel).toBe('cautious');
    });

    test('rejects invalid threadReplyMode', () => {
      expect(() => updateIdentitySchema.parse({ threadReplyMode: 'invalid' })).toThrow();
    });

    test('rejects invalid autonomyLevel', () => {
      expect(() => updateIdentitySchema.parse({ autonomyLevel: 'reckless' })).toThrow();
    });

    test('accepts empty object (all optional)', () => {
      const result = updateIdentitySchema.parse({});
      expect(result).toBeDefined();
    });
  });
});
