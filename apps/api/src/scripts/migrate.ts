// 必须是第一个 import:加载仓库根目录 .env.local(详见 env-loader 注释)。
import '../env-loader';

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
  // 默认从仓库根解析(src/scripts 向上四级),而不是 process.cwd():
  // 否则 cd apps/api 直跑时会在 apps/api/packages/db 下找迁移文件。
  // 容器里 src 与 packages 同源于应用根,两种解析结果一致;特殊布局仍可用
  // DRIZZLE_MIGRATIONS_FOLDER 覆盖。
  const migrationsFolder =
    process.env.DRIZZLE_MIGRATIONS_FOLDER ??
    path.resolve(__dirname, '../../../../packages/db/drizzle');
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
