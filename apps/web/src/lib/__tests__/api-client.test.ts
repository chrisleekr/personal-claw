import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const originalFetch = globalThis.fetch;
let mockFetchResponse: { status: number; body: unknown } = { status: 200, body: {} };

beforeEach(() => {
  globalThis.fetch = mock(async (_url: string | URL | Request, _init?: RequestInit) => {
    return new Response(JSON.stringify(mockFetchResponse.body), {
      status: mockFetchResponse.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  mockFetchResponse = { status: 200, body: {} };
});

import { api } from '../api-client';

describe('api client', () => {
  describe('proxy routing', () => {
    test('routes requests through /api/proxy', async () => {
      mockFetchResponse = { status: 200, body: { data: [] } };
      await api.channels.list();
      const calledUrl = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0][0] as string;
      expect(calledUrl).toBe('/api/proxy/api/channels');
    });

    test('sends Content-Type header', async () => {
      mockFetchResponse = { status: 200, body: { data: [] } };
      await api.channels.list();
      const calledInit = (globalThis.fetch as ReturnType<typeof mock>).mock
        .calls[0][1] as RequestInit;
      expect((calledInit.headers as Record<string, string>)['Content-Type']).toBe(
        'application/json',
      );
    });
  });

  describe('channels', () => {
    test('list calls correct endpoint', async () => {
      mockFetchResponse = { status: 200, body: { data: [{ id: 'ch1' }] } };
      const result = await api.channels.list();
      expect(result.data).toHaveLength(1);
      const calledUrl = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0][0] as string;
      expect(calledUrl).toContain('/api/channels');
    });

    test('get calls correct endpoint with id', async () => {
      mockFetchResponse = { status: 200, body: { data: { id: 'ch1' } } };
      await api.channels.get('ch1');
      const calledUrl = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0][0] as string;
      expect(calledUrl).toContain('/api/channels/ch1');
    });

    test('create sends POST with body', async () => {
      mockFetchResponse = { status: 200, body: { data: { id: 'ch1' } } };
      await api.channels.create({ externalId: 'C123' });
      const calledInit = (globalThis.fetch as ReturnType<typeof mock>).mock
        .calls[0][1] as RequestInit;
      expect(calledInit.method).toBe('POST');
      expect(calledInit.body).toBeDefined();
    });

    test('delete sends DELETE method', async () => {
      mockFetchResponse = { status: 200, body: { data: { deleted: true } } };
      await api.channels.delete('ch1');
      const calledInit = (globalThis.fetch as ReturnType<typeof mock>).mock
        .calls[0][1] as RequestInit;
      expect(calledInit.method).toBe('DELETE');
    });
  });

  describe('error handling', () => {
    test('throws on non-ok response', async () => {
      mockFetchResponse = { status: 500, body: { message: 'Internal error' } };
      expect(api.channels.list()).rejects.toThrow('Internal error');
    });

    test('throws generic message when server message missing', async () => {
      mockFetchResponse = { status: 404, body: {} };
      expect(api.channels.get('nonexistent')).rejects.toThrow('API error: 404');
    });
  });

  describe('memories', () => {
    test('search encodes query parameter', async () => {
      mockFetchResponse = { status: 200, body: { data: [] } };
      await api.memories.search('ch1', 'hello world');
      const calledUrl = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0][0] as string;
      expect(calledUrl).toContain('q=hello%20world');
    });

    test('update sends PATCH with body', async () => {
      mockFetchResponse = { status: 200, body: { data: {} } };
      await api.memories.update('mem1', { content: 'updated' });
      const calledInit = (globalThis.fetch as ReturnType<typeof mock>).mock
        .calls[0][1] as RequestInit;
      expect(calledInit.method).toBe('PATCH');
    });
  });

  describe('skills', () => {
    test('list calls correct channel endpoint', async () => {
      mockFetchResponse = { status: 200, body: { data: [] } };
      await api.skills.list('ch1');
      const calledUrl = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0][0] as string;
      expect(calledUrl).toContain('/api/skills/ch1');
    });
  });

  describe('usage', () => {
    test('getBudget calls correct endpoint', async () => {
      mockFetchResponse = { status: 200, body: { data: { dailyBudget: 10 } } };
      const _result = await api.usage.getBudget('ch1');
      const calledUrl = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0][0] as string;
      expect(calledUrl).toContain('/api/usage/ch1/budget');
    });

    test('getDaily calls correct endpoint', async () => {
      mockFetchResponse = { status: 200, body: { data: [] } };
      await api.usage.getDaily('ch1');
      const calledUrl = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0][0] as string;
      expect(calledUrl).toContain('/api/usage/ch1/daily');
    });
  });
});
