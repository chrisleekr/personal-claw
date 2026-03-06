import { createDb, type Database } from '@personalclaw/db';
import { config } from './config';

let dbInstance: Database | null = null;

export function getDb() {
  if (!dbInstance) {
    dbInstance = createDb(config.DATABASE_URL);
  }
  return dbInstance;
}
