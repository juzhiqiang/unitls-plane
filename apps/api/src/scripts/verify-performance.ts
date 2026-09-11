import '../env-loader';
import { spawn } from 'bun';
import postgres from 'postgres';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { FilesService } from '../modules/files/files.service';
import { TasksService } from '../modules/tasks/tasks.service';
import { MinioService } from '../modules/files/minio.service';

// 本地迁移和查询计划核对；只对 .env.local 配置的本地数据库运行。
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
    throw new Error('Performance verification requires a local DATABASE_URL');
  }
  const sql = postgres(url, { connect_timeout: 3, max: 1 });
  try {
    await sql`select 1`;
    const child = spawn(['bunx', 'drizzle-kit', 'migrate'], {
      cwd: resolve(process.cwd(), '../../packages/db'),
      env: { ...process.env, DATABASE_URL: url },
      stdout: 'inherit',
      stderr: 'inherit',
    });
    if ((await child.exited) !== 0) throw new Error('Migration failed');
    const [filenameSearchSchema] = await sql`
      select
        exists (
          select 1
          from pg_extension
          where extname = 'pg_trgm'
        ) as extension_exists,
        exists (
          select 1
          from pg_indexes
          where schemaname = current_schema()
            and tablename = 'files'
            and indexname = 'files_filename_trgm_idx'
        ) as index_exists
    `;
    assert.equal(
      filenameSearchSchema?.extension_exists,
      true,
      'pg_trgm extension is missing'
    );
    assert.equal(
      filenameSearchSchema?.index_exists,
      true,
      'files filename trigram index is missing'
    );
    console.log(
      'Filename search schema: pg_trgm and files_filename_trgm_idx exist'
    );
    const queries = [
      `select id from files where user_id = (select id from "user" limit 1) and deleted_at is null and purge_started_at is null order by created_at desc, id desc limit 21`,
      `select id from files where user_id = (select id from "user" limit 1) and deleted_at is not null and purge_started_at is null order by deleted_at desc, id desc limit 21`,
      `select id from files where user_id = (select id from "user" limit 1) and filename like '%sample%' and deleted_at is null and purge_started_at is null order by created_at desc, id desc limit 21`,
      `select id from tasks where user_id = (select id from "user" limit 1) and status = 'completed' order by created_at desc, id desc limit 21`,
    ];
    for (const query of queries) {
      console.log(query);
      const rows = await sql.unsafe(`EXPLAIN (ANALYZE, BUFFERS) ${query}`);
      console.log(rows.map(row => row['QUERY PLAN']).join('\n'));
    }
    // 小表自然计划可能选择顺序扫描；仅在当前事务验证索引可用性。
    await sql.begin(async tx => {
      await tx`set local enable_seqscan = off`;
      for (const query of queries) {
        const rows = await tx.unsafe(`EXPLAIN ${query}`);
        console.log(
          'Index eligibility:',
          rows.map(row => row['QUERY PLAN']).join('\n')
        );
      }
    });
    const [owner] = await sql`select id from "user" limit 1`;
    if (owner) {
      const files = new FilesService({} as never, {} as never, {} as never);
      const tasks = new TasksService(
        ...(Array(8).fill({}) as ConstructorParameters<typeof TasksService>)
      );
      for (const [label, fetchPage] of [
        [
          'files',
          (cursor?: string) => files.listByUser(owner.id, { limit: 7, cursor }),
        ],
        [
          'trash',
          (cursor?: string) =>
            files.listTrashed(owner.id, { limit: 7, cursor }),
        ],
        [
          'tasks',
          (cursor?: string) =>
            tasks.listByUser(owner.id, { page: 1, limit: 7, cursor }),
        ],
      ] as const) {
        const seen = new Set<string>();
        let cursor: string | undefined = '';
        let expected = 0;
        do {
          const page: Awaited<ReturnType<typeof fetchPage>> =
            await fetchPage(cursor);
          expected = Number(page.total);
          const rows = 'files' in page ? page.files : page.tasks;
          for (const row of rows) {
            assert(!seen.has(row.id), 'Duplicate cursor row');
            seen.add(row.id);
          }
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        assert.equal(seen.size, expected);
        console.log(
          `${label}: cursor traversed ${seen.size} rows without duplication or omission`
        );
      }
    }
    const [object] =
      await sql`select storage_key, original_size from files where deleted_at is null and purge_started_at is null limit 1`;
    if (object) {
      const source = await new MinioService().downloadStream(
        object.storage_key
      );
      let bytes = 0;
      for await (const chunk of source) bytes += chunk.length;
      assert.equal(bytes, Number(object.original_size));
      console.log(`MinIO stream: ${bytes} bytes match stored size`);
    }
  } catch (error) {
    const value = error as Error & { code?: string };
    console.error(
      'Performance verification failed:',
      value.code ?? '',
      value.message
    );
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
  process.exit(process.exitCode ?? 0);
}
void main();
