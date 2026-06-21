import * as path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run database migrations');
  }

  return databaseUrl;
}

async function main() {
  const migrationsFolder =
    process.env.DRIZZLE_MIGRATIONS_FOLDER ??
    path.resolve(process.cwd(), 'packages/db/drizzle');
  const client = postgres(getDatabaseUrl(), { max: 1 });
  const db = drizzle(client);

  try {
    console.log(`[db:migrate] Running migrations from ${migrationsFolder}`);
    await migrate(db, { migrationsFolder });
    console.log('[db:migrate] Migrations complete');
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error('[db:migrate] Migration failed');
  console.error(error);
  process.exit(1);
});
