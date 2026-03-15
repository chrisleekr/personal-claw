import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const originalFetch = globalThis.fetch;
let mockFetchResponses: Array<{ status: number; body: unknown }> = [];

function pushResponse(status: number, body: unknown) {
  mockFetchResponses.push({ status, body });
}

/** Set up the default token + API responses for a standard successful call. */
function mockTokenAndApi(apiBody: unknown, apiStatus = 200) {
  pushResponse(200, { token: 'test-api-secret' }); // token endpoint
  pushResponse(apiStatus, apiBody); // actual API call
}

import { api, clearApiToken } from '../api-client';

beforeEach(() => {
  clearApiToken();
  mockFetchResponses = [];
  globalThis.fetch = mock(async (_url: string | URL | Request, _init?: RequestInit) => {
    const resp = mockFetchResponses.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(resp.body), {
      status: resp.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  mockFetchResponses = [];
});

describe('api client', () => {
  describe('auth', () => {
    test('sends Authorization header with Bearer token', async () => {
      mockTokenAndApi({ data: [] });
      await api.channels.list();
      const calls = (globalThis.fetch as ReturnType<typeof mock>).mock.calls;
      // First call is the token fetch, second is the API call
      expect(calls).toHaveLength(2);
      const tokenUrl = calls[0][0] as string;
      expect(tokenUrl).toBe('/api/auth/api-token');
      const apiInit = calls[1][1] as RequestInit;
      expect((apiInit.headers as Record<string, string>)['Authorization']).toBe(
        'Bearer test-api-secret',
      );
    });

    test('caches token across multiple calls', async () => {
      mockTokenAndApi({ data: [] });
      pushResponse(200, { data: [] }); // second API call reuses cached token
      await api.channels.list();
      await api.channels.list();
      const calls = (globalThis.fetch as ReturnType<typeof mock>).mock.calls;
      // Token fetched once, API called twice
      expect(calls).toHaveLength(3);
      expect(calls[0][0] as string).toBe('/api/auth/api-token');
      expect(calls[1][0] as string).toContain('/api/channels');
      expect(calls[2][0] as string).toContain('/api/channels');
    });

    test('omits Authorization header when token endpoint fails', async () => {
      pushResponse(401, { error: 'unauthorized' }); // token fetch fails
      pushResponse(200, { data: [] }); // API call still made
      await api.channels.list();
      const calls = (globalThis.fetch as ReturnType<typeof mock>).mock.calls;
      expect(calls).toHaveLength(2);
      const apiInit = calls[1][1] as RequestInit;
      const headers = apiInit.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });
  });

  describe('channels', () => {
    test('list calls correct endpoint', async () => {
      mockTokenAndApi({ data: [{ id: 'ch1' }] });
      const result = await api.channels.list();
      expect(result.data).toHaveLength(1);
      const calledUrl = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[1][0] as string;
      expect(calledUrl).toContain('/api/channels');
    });

    test('get calls correct endpoint with id', async () => {
      mockTokenAndApi({ data: { id: 'ch1' } });
      await api.channels.get('ch1');
      const calledUrl = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[1][0] as string;
      expect(calledUrl).toContain('/api/channels/ch1');
    });

    test('create sends POST with body', async () => {
      mockTokenAndApi({ data: { id: 'ch1' } });
      await api.channels.create({ externalId: 'C123' });
      const calledInit = (globalThis.fetch as ReturnType<typeof mock>).mock
        .calls[1][1] as RequestInit;
      expect(calledInit.method).toBe('POST');
      expect(calledInit.body).toBeDefined();
    });

    test('delete sends DELETE method', async () => {
      mockTokenAndApi({ data: { deleted: true } });
      await api.channels.delete('ch1');
      const calledInit = (globalThis.fetch as ReturnType<typeof mock>).mock
        .calls[1][1] as RequestInit;
      expect(calledInit.method).toBe('DELETE');
    });
  });

  describe('error handling', () => {
    test('throws on non-ok response', async () => {
      mockTokenAndApi({ message: 'Internal error' }, 500);
      expect(api.channels.list()).rejects.toThrow('Internal error');
    });

    test('throws generic message when server message missing', async () => {
      mockTokenAndApi({}, 404);
      expect(api.channels.get('nonexistent')).rejects.toThrow('API error: 404');
    });
  });

  describe('memories', () => {
    test('search encodes query parameter', async () => {
      mockTokenAndApi({ data: [] });
      await api.memories.search('ch1', 'hello world');
      const calledUrl = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[1][0] as string;
      expect(calledUrl).toContain('q=hello%20world');
    });

    test('update sends PATCH with body', async () => {
      mockTokenAndApi({ data: {} });
      await api.memories.update('mem1', { content: 'updated' });
      const calledInit = (globalThis.fetch as ReturnType<typeof mock>).mock
        .calls[1][1] as RequestInit;
      expect(calledInit.method).toBe('PATCH');
    });
  });

  describe('skills', () => {
    test('list calls correct channel endpoint', async () => {
      mockTokenAndApi({ data: [] });
      await api.skills.list('ch1');
      const calledUrl = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[1][0] as string;
      expect(calledUrl).toContain('/api/skills/ch1');
    });
  });

  describe('usage', () => {
    test('getBudget calls correct endpoint', async () => {
      mockTokenAndApi({ data: { dailyBudget: 10 } });
      const _result = await api.usage.getBudget('ch1');
      const calledUrl = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[1][0] as string;
      expect(calledUrl).toContain('/api/usage/ch1/budget');
    });

    test('getDaily calls correct endpoint', async () => {
      mockTokenAndApi({ data: [] });
      await api.usage.getDaily('ch1');
      const calledUrl = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[1][0] as string;
      expect(calledUrl).toContain('/api/usage/ch1/daily');
    });
  });
});
