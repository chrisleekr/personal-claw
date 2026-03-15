import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

const API_URL = process.env.API_URL || 'http://localhost:4000';

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

  const headers = new Headers();
  headers.set('Authorization', `Bearer ${apiSecret}`);
  const contentType = request.headers.get('Content-Type');
  if (contentType) {
    headers.set('Content-Type', contentType);
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
  return new NextResponse(responseBody, {
    status: backendResponse.status,
    headers: {
      'Content-Type': backendResponse.headers.get('Content-Type') || 'application/json',
    },
  });
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
