import { describe, expect, it, vi } from 'bun:test';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { countTasksCreatedToday } from './daily-task-quota';

function fakeDatabase(count: number) {
  const conditions: SQL[] = [];
  const where = vi.fn(async (condition: SQL) => {
    conditions.push(condition);
    return [{ count }];
  });
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { database: { select }, select, from, where, conditions };
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

  it('scopes the count to the user, the type, today, and non-failed tasks', async () => {
    const { database, conditions } = fakeDatabase(0);

    await countTasksCreatedToday(database as never, 'user-1', 'image_generate');

    const condition = conditions[0];
    if (!condition) throw new Error('Expected a where condition');
    const query = new PgDialect().sqlToQuery(condition);

    expect(query.sql).toMatch(/"tasks"\."user_id"\s*=\s*\$\d+/);
    expect(query.sql).toMatch(/"tasks"\."type"\s*=\s*\$\d+/);
    expect(query.sql).toMatch(/"tasks"\."status"\s*<>\s*\$\d+/);
    expect(query.sql).toMatch(
      /"tasks"\."created_at"\s*>=\s*date_trunc\('day',\s*now\(\)\)/
    );
    expect(query.params).toEqual(['user-1', 'image_generate', 'failed']);
  });
});
