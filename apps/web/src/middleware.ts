import NextAuth, { type NextAuthResult } from 'next-auth';
import authConfig from '@/lib/auth.config';

const nextAuth: NextAuthResult = NextAuth(authConfig);
const middleware: NextAuthResult['auth'] = nextAuth.auth;
export default middleware;

export const config = {
  matcher: ['/((?!api/auth|api/proxy|_next/static|_next/image|favicon\\.ico).*)'],
};
