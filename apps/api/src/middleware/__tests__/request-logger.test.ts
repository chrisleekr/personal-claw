import { describe, expect, test } from 'bun:test';

import { Hono } from 'hono';
import { requestBodyLogger } from '../request-logger';

function createApp() {
  const app = new Hono();
  app.use('*', requestBodyLogger);
  app.post('/test', async (c) => {
    const ct = c.req.header('content-type') ?? '';
    if (ct.includes('application/json')) {
      const text = await c.req.text();
      if (!text) return c.json({ echo: null });
      const body = JSON.parse(text);
      return c.json({ echo: body });
    }
    return c.json({ echo: 'non-json' });
  });
  app.get('/test', (c) => c.json({ ok: true }));
  app.all('/health', (c) => c.json({ status: 'ok' }));
  app.put('/test', async (c) => {
    const body = await c.req.json();
    return c.json({ echo: body });
  });
  return app;
}

describe('requestBodyLogger', () => {
  test('passes through GET requests without logging body', async () => {
    const app = createApp();
    const res = await app.request('/test');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('passes through health endpoint', async () => {
    const app = createApp();
    const res = await app.request('/health', { method: 'POST' });
    expect(res.status).toBe(200);
  });

  test('processes POST request with JSON body', async () => {
    const app = createApp();
    const res = await app.request(
      new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.echo.message).toBe('hello');
  });

  test('processes PUT request with JSON body', async () => {
    const app = createApp();
    const res = await app.request(
      new Request('http://localhost/test', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'updated' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.echo.name).toBe('updated');
  });

  test('handles request with non-JSON content type', async () => {
    const app = createApp();
    const res = await app.request(
      new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'plain text body',
      }),
    );
    expect(res.status).toBe(200);
  });

  test('handles request with empty body', async () => {
    const app = createApp();
    const res = await app.request(
      new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '',
      }),
    );
    expect(res.status).toBe(200);
  });
});
