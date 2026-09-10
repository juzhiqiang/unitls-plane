import '../env-loader';
import postgres from 'postgres';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';

// 仅对本地数据库创建连接私有临时表，不读取、写入或迁移业务表。
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
    throw new Error('仅允许本地数据库基准验证');
  }
  const sql = postgres(url, { max: 1, connect_timeout: 3 });
  try {
    await sql.begin(async tx => {
      await tx`set local statement_timeout = '15s'`;
      await tx`create temporary table pagination_benchmark (
        id bigint primary key, user_id text not null, created_at timestamp not null,
        payload text not null
      ) on commit drop`;
      await tx`insert into pagination_benchmark
        select n, 'synthetic-user', timestamp '2026-01-01' + n * interval '1 microsecond', repeat('x', 128)
        from generate_series(1, 100000) n`;
      await tx`create index on pagination_benchmark(user_id, created_at desc, id desc)`;
      await tx`analyze pagination_benchmark`;
      const cursor =
        await tx`select to_char(created_at, 'YYYY-MM-DD HH24:MI:SS.US') as cursor_time, id from pagination_benchmark order by created_at desc, id desc offset 89999 limit 1`;
      const boundary = cursor[0]!;
      const offsetRows =
        await tx`select id from pagination_benchmark where user_id = 'synthetic-user' order by created_at desc, id desc limit 21 offset 90000`;
      const cursorRows =
        await tx`select id from pagination_benchmark where user_id = 'synthetic-user' and (created_at, id) < (${boundary.cursor_time}::text::timestamp, ${boundary.id}) order by created_at desc, id desc limit 21`;
      assert.equal(cursorRows.length, 21);
      assert.deepEqual(
        cursorRows.map(row => row.id),
        offsetRows.map(row => row.id)
      );
      const samples: Record<string, number[]> = {
        offset: [],
        cursor: [],
        count: [],
      };
      const run = async (name: keyof typeof samples) => {
        const start = performance.now();
        if (name === 'offset')
          await tx`select * from pagination_benchmark where user_id = 'synthetic-user' order by created_at desc, id desc limit 21 offset 90000`;
        else if (name === 'cursor')
          await tx`select * from pagination_benchmark where user_id = 'synthetic-user' and (created_at, id) < (${boundary.cursor_time}::text::timestamp, ${boundary.id}) order by created_at desc, id desc limit 21`;
        else
          await tx`select count(*) from pagination_benchmark where user_id = 'synthetic-user'`;
        return performance.now() - start;
      };
      for (const name of Object.keys(samples)) await run(name);
      for (let i = 0; i < 30; i++) {
        for (const name of Object.keys(samples))
          samples[name]!.push(await run(name));
      }
      for (const [name, values] of Object.entries(samples)) {
        values.sort((a, b) => a - b);
        console.log(
          JSON.stringify({
            name,
            rows: 100000,
            offset: 90000,
            samples: 30,
            p50Ms: values[14],
            p95Ms: values[28],
          })
        );
      }
      const plans = [
        await tx`explain (analyze, buffers) select * from pagination_benchmark where user_id = 'synthetic-user' order by created_at desc, id desc limit 21 offset 90000`,
        await tx`explain (analyze, buffers) select * from pagination_benchmark where user_id = 'synthetic-user' and (created_at, id) < (${boundary.cursor_time}::text::timestamp, ${boundary.id}) order by created_at desc, id desc limit 21`,
      ];
      for (const plan of plans)
        console.log(plan.map(row => row['QUERY PLAN']).join('\n'));
    });
  } finally {
    await sql.end();
  }
}
main().catch(() => {
  console.error('本地临时表基准未完成，请核对数据库可用性；未输出连接凭据。');
  process.exitCode = 1;
});
