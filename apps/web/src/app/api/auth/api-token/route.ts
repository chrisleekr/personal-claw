import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const token = process.env.API_SECRET;
  if (!token) {
    return NextResponse.json(
      { error: 'server_misconfiguration', message: 'API_SECRET is not configured' },
      { status: 503 },
    );
  }

  return NextResponse.json({ token });
}
