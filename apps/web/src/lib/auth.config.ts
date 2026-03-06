import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';

const authConfig: NextAuthConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    }),
  ],
  pages: { signIn: '/login' },
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const isOnLogin = request.nextUrl.pathname === '/login';

      if (isOnLogin) {
        if (isLoggedIn) return Response.redirect(new URL('/', request.nextUrl));
        return true;
      }

      return isLoggedIn;
    },
  },
};

export default authConfig;
