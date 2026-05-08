import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

const API_URL = process.env.API_URL || 'http://localhost:4000';

/** Request headers safe to forward to the backend (lowercase). */
const FORWARDED_REQUEST_HEADERS = ['content-type', 'accept'];
/** Response headers safe to forward back to the browser (lowercase). */
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'x-request-id', 'cache-control'];

async function proxyRequest(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const apiSecret = process.env.API_SECRET;
  if (!apiSecret) {
    return NextResponse.json(
      { error: 'server_misconfiguration', message: 'API_SECRET is not configured' },
      { status: 503 },
    );
  }

  const { path } = await params;
  const backendPath = `/${path.join('/')}`;
  const url = new URL(backendPath, API_URL);
  url.search = request.nextUrl.search;

  // Validate the resolved pathname to prevent SSRF via directory traversal.
  // new URL resolves '..' segments, so '/api/../../internal' becomes '/internal'.
  if (!url.pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'forbidden', message: 'Invalid proxy path' },
      { status: 403 },
    );
  }

  const headers = new Headers();
  headers.set('Authorization', `Bearer ${apiSecret}`);
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  // Forward the authenticated web-session user identity to the backend as
  // `X-User-Id`. This is derived exclusively from `session.user` — NEVER
  // from an incoming request header — so a malicious client cannot
  // impersonate another user by spoofing the header. The backend uses this
  // value to enforce per-channel admin membership (FR-033 detection-
  // overrides route and any future admin-only REST endpoints).
  //
  // Prefer email when present (Google OAuth always provides it) because
  // that's the canonical admin identifier across Slack and the web UI.
  // Fall back to the auth.js user id as a last resort. If neither is set,
  // the backend write handler will return 400 ('X-User-Id header required').
  const sessionUserId = session.user.email ?? session.user.id ?? '';
  if (sessionUserId) {
    headers.set('X-User-Id', sessionUserId);
  }

  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text();

  let backendResponse: Response;
  try {
    backendResponse = await fetch(url.toString(), {
      method: request.method,
      headers,
      body,
    });
  } catch {
    return NextResponse.json(
      { error: 'bad_gateway', message: 'Unable to reach backend API' },
      { status: 502 },
    );
  }

  const responseBody = await backendResponse.text();
  const responseHeaders = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = backendResponse.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  if (!responseHeaders.has('content-type')) {
    responseHeaders.set('content-type', 'application/json');
  }
  return new NextResponse(responseBody, {
    status: backendResponse.status,
    headers: responseHeaders,
  });
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
