import { DrizzleAdapter } from '@auth/drizzle-adapter';
import type { Database } from '@personalclaw/db';
import { accounts, createDb, users } from '@personalclaw/db';
import NextAuth, { type NextAuthResult } from 'next-auth';
import authConfig from './auth.config';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

let _db: Database | undefined;
function getDb(): Database {
  if (!_db) {
    _db = createDb(requiredEnv('DATABASE_URL'));
  }
  return _db;
}

const nextAuth: NextAuthResult = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(getDb(), {
    usersTable: users,
    accountsTable: accounts,
  }),
  session: { strategy: 'jwt' },
});

export const handlers: NextAuthResult['handlers'] = nextAuth.handlers;
export const signIn: NextAuthResult['signIn'] = nextAuth.signIn;
export const signOut: NextAuthResult['signOut'] = nextAuth.signOut;
export const auth: NextAuthResult['auth'] = nextAuth.auth;
