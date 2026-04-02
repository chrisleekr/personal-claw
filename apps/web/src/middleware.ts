import NextAuth, { type NextAuthResult } from 'next-auth';
import authConfig from '@/lib/auth.config';

const nextAuth: NextAuthResult = NextAuth(authConfig);
const middleware: NextAuthResult['auth'] = nextAuth.auth;
export default middleware;

export const config = {
  // api/proxy is excluded because the proxy route handler calls auth() internally.
  // This avoids running the session check twice. Keep auth() in the proxy handler.
  matcher: ['/((?!api/auth|api/proxy|_next/static|_next/image|favicon\\.ico).*)'],
};
