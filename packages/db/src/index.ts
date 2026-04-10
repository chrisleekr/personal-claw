import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export function createDb(connectionString: string) {
  const client = postgres(connectionString);
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;

export { and, count, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql, sum } from 'drizzle-orm';
export * from './schema';
