import { describe, expect, it, vi } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { countTasksCreatedToday } from './daily-task-quota';

function fakeDatabase(count: number) {
  const where = vi.fn(async () => [{ count }]);
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { database: { select }, select, from, where };
}

// 谓词断言必须拿到真实的 drizzle SQL 对象才能序列化,但 bun test 的 mock.module 是进程级的:
// 同一次 `bun test src` 里,files.service.test.ts / account.repository.test.ts 等文件会把
// 'drizzle-orm' 的 and/gte/sql 和 '@utils-plane/db' 的 tasks 换成桩。这种替换会写穿到底层
// export 绑定,子路径 import('drizzle-orm/sql') 和带 query 的重新 import 都拿不回真实实现,
// 所以同进程内无法恢复。这条断言改为在一个干净的子进程里跑真实模块,把序列化结果读回来断言,
// 与任何 mock.module 顺序无关。
const WHERE_CLAUSE_PROBE = `
const { PgDialect } = await import('drizzle-orm/pg-core');
const { countTasksCreatedToday } = await import(${JSON.stringify(
  new URL('./daily-task-quota.ts', import.meta.url).href
)});
const conditions = [];
const where = async condition => {
  conditions.push(condition);
  return [{ count: 0 }];
};
const database = { select: () => ({ from: () => ({ where }) }) };
await countTasksCreatedToday(database, 'user-1', 'image_generate');
const query = new PgDialect().sqlToQuery(conditions[0]);
console.log(JSON.stringify({ sql: query.sql, params: query.params }));
`;

function serializeWhereClause(): { sql: string; params: unknown[] } {
  const probe = spawnSync(process.execPath, ['--eval', WHERE_CLAUSE_PROBE], {
    cwd: import.meta.dir,
    encoding: 'utf8',
  });

  if (probe.status !== 0) {
    throw new Error(
      `where clause probe exited with ${probe.status}: ${probe.stderr}`
    );
  }

  const lines = probe.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  const payload = lines.at(-1);
  if (!payload) throw new Error('where clause probe produced no output');

  return JSON.parse(payload) as { sql: string; params: unknown[] };
}

describe('countTasksCreatedToday', () => {
  it('returns the counted rows', async () => {
    const { database } = fakeDatabase(7);

    await expect(
      countTasksCreatedToday(database as never, 'user-1', 'image_generate')
    ).resolves.toBe(7);
  });

  it('treats a missing row as zero', async () => {
    const where = vi.fn(async () => []);
    const database = { select: vi.fn(() => ({ from: () => ({ where }) })) };

    await expect(
      countTasksCreatedToday(database as never, 'user-1', 'image_generate')
    ).resolves.toBe(0);
  });

  it('builds one select against a single where clause', async () => {
    const { database, select, from, where } = fakeDatabase(0);

    await countTasksCreatedToday(database as never, 'user-1', 'image_generate');

    expect(select).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
  });

  it('scopes the count to the user, the type, today, and non-failed tasks', () => {
    const query = serializeWhereClause();

    expect(query.sql).toMatch(/"tasks"\."user_id"\s*=\s*\$\d+/);
    expect(query.sql).toMatch(/"tasks"\."type"\s*=\s*\$\d+/);
    expect(query.sql).toMatch(/"tasks"\."status"\s*<>\s*\$\d+/);
    expect(query.sql).toMatch(
      /"tasks"\."created_at"\s*>=\s*date_trunc\('day',\s*now\(\)\)/
    );
    expect(query.params).toEqual(['user-1', 'image_generate', 'failed']);
  });
});
