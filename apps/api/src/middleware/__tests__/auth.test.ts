import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

let mockApiSecret: string | undefined = 'test-secret-123';

mock.module('../../config', () => ({
  config: new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'API_SECRET') return mockApiSecret;
        return undefined;
      },
    },
  ),
}));

import { Hono } from 'hono';
import { authMiddleware } from '../auth';

function createApp() {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.get('/test', (c) => c.json({ ok: true }));
  return app;
}

describe('authMiddleware', () => {
  let app: Hono;

  beforeEach(() => {
    app = createApp();
    mockApiSecret = 'test-secret-123';
  });

  afterEach(() => {
    mockApiSecret = 'test-secret-123';
  });

  test('allows request with valid Bearer token', async () => {
    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer test-secret-123' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('rejects request without Authorization header', async () => {
    const res = await app.request('/test');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
    expect(body.message).toContain('Missing');
  });

  test('rejects request with wrong token', async () => {
    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
    expect(body.message).toContain('Invalid');
  });

  test('rejects request with non-Bearer scheme', async () => {
    const res = await app.request('/test', {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(res.status).toBe(401);
  });

  test('returns 503 when API_SECRET is not configured', async () => {
    mockApiSecret = undefined;
    const res = await app.request('/test');
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('server_misconfiguration');
    expect(body.message).toContain('Authentication is not configured');
  });

  test('rejects empty Authorization header', async () => {
    const res = await app.request('/test', {
      headers: { Authorization: '' },
    });
    expect(res.status).toBe(401);
  });

  test('rejects token with different length than secret', async () => {
    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer short' },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
  });
});
