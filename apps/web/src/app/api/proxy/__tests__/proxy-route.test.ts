import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { NextRequest } from 'next/server';

// --- Mocks ---

let mockSession: { user: { name: string } } | null = { user: { name: 'Test' } };

mock.module('@/lib/auth', () => ({
  auth: async () => mockSession,
}));

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof mock>;
let mockApiSecret: string | undefined = 'test-secret-that-is-long-enough-for-prod';

const originalEnv = { ...process.env };

beforeEach(() => {
  mockSession = { user: { name: 'Test' } };
  mockApiSecret = 'test-secret-that-is-long-enough-for-prod';
  process.env.API_SECRET = mockApiSecret;
  process.env.API_URL = 'http://backend:4000';

  fetchMock = mock(async () => {
    return new Response(JSON.stringify({ data: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  globalThis.fetch = fetchMock as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.API_SECRET = originalEnv.API_SECRET;
  process.env.API_URL = originalEnv.API_URL;
});

// Dynamic import after mocks are set up
const { GET, POST } = await import('../[...path]/route');

function makeRequest(path: string, init?: RequestInit): NextRequest {
  const url = new URL(`http://localhost:3000/api/proxy/${path}`);
  const req = new Request(url.toString(), init);
  // Simulate NextRequest.nextUrl which Next.js adds at runtime
  Object.defineProperty(req, 'nextUrl', { value: url });
  return req as unknown as NextRequest;
}

function makeParams(path: string): { params: Promise<{ path: string[] }> } {
  return { params: Promise.resolve({ path: path.split('/') }) };
}

describe('proxy route', () => {
  describe('authentication', () => {
    test('returns 401 when session is missing', async () => {
      mockSession = null;
      const res = await GET(makeRequest('api/channels'), makeParams('api/channels'));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('unauthorized');
    });

    test('returns 503 when API_SECRET is not set', async () => {
      process.env.API_SECRET = '';
      // Re-import won't help since proxyRequest reads env at call time
      // but the mock reads it from process.env, so we need to also clear it
      delete process.env.API_SECRET;

      // We need to test with a fresh module that reads undefined API_SECRET
      // Since the route reads process.env.API_SECRET at request time, this works
      const res = await GET(makeRequest('api/channels'), makeParams('api/channels'));
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toBe('server_misconfiguration');
    });
  });

  describe('SSRF protection', () => {
    test('rejects paths not starting with /api/', async () => {
      const res = await GET(makeRequest('health'), makeParams('health'));
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe('forbidden');
    });

    test('rejects paths attempting directory traversal', async () => {
      const res = await GET(makeRequest('api/../../internal'), makeParams('api/../../internal'));
      // new URL('/api/../../internal', base) resolves to '/internal'
      // which does not start with '/api/' — blocked as SSRF
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe('forbidden');
    });

    test('allows valid /api/ paths', async () => {
      const res = await GET(makeRequest('api/channels'), makeParams('api/channels'));
      expect(res.status).toBe(200);
    });
  });

  describe('header forwarding', () => {
    test('forwards Content-Type to backend', async () => {
      await POST(
        makeRequest('api/channels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'test' }),
        }),
        makeParams('api/channels'),
      );
      const [, fetchInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = fetchInit.headers as Headers;
      expect(headers.get('content-type')).toBe('application/json');
    });

    test('sets Authorization with API_SECRET', async () => {
      await GET(makeRequest('api/channels'), makeParams('api/channels'));
      const [, fetchInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = fetchInit.headers as Headers;
      expect(headers.get('authorization')).toBe(`Bearer ${mockApiSecret}`);
    });

    test('does not forward arbitrary request headers', async () => {
      await GET(
        makeRequest('api/channels', {
          headers: { 'X-Evil': 'injected' },
        }),
        makeParams('api/channels'),
      );
      const [, fetchInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = fetchInit.headers as Headers;
      expect(headers.get('x-evil')).toBeNull();
    });
  });

  describe('backend communication', () => {
    test('returns 502 when backend is unreachable', async () => {
      globalThis.fetch = mock(async () => {
        throw new Error('ECONNREFUSED');
      }) as typeof fetch;

      const res = await GET(makeRequest('api/channels'), makeParams('api/channels'));
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error).toBe('bad_gateway');
    });

    test('preserves query parameters', async () => {
      const req = makeRequest('api/channels?limit=10&offset=0');
      await GET(req, makeParams('api/channels'));
      const [calledUrl] = fetchMock.mock.calls[0] as [string];
      expect(calledUrl).toContain('limit=10');
      expect(calledUrl).toContain('offset=0');
    });
  });
});
