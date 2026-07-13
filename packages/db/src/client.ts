import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

function getDatabaseUrl(): string {
  if (typeof process !== 'undefined' && process.env?.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  return 'postgresql://utils:utils@localhost:5433/utils_plane';
}

const connectionString = getDatabaseUrl();

const client = postgres(connectionString, { max: 20 });

export const db = drizzle(client, { schema });

export * from './schema';

export type Database = typeof db;
