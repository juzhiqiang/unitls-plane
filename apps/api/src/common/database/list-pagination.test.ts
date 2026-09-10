import { describe, it, expect } from 'bun:test';
import { pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  cursorCondition,
  finishPage,
  paginationOptions,
} from './list-pagination';

const table = pgTable('items', { id: uuid('id'), time: timestamp('time') });
describe('list pagination', () => {
  it('preserves microseconds and ties by id without exposing the cursor column', () => {
    const rows = [1, 2, 3].map(n => ({
      id: `00000000-0000-4000-8000-00000000000${n}`,
      cursorTime: '2026-09-09 12:00:00.123456',
    }));
    const page = finishPage(rows, 2, 'files');
    expect(page.items).toEqual(rows.slice(0, 2).map(({ id }) => ({ id })));
    const condition = cursorCondition(
      page.nextCursor!,
      'files',
      table.time,
      table.id
    )!;
    const query = new PgDialect().sqlToQuery(condition);
    expect(query.params).toEqual(['2026-09-09 12:00:00.123456', rows[1]!.id]);
    expect(query.sql).toContain('<');
    expect(finishPage(rows, 3, 'files').nextCursor).toBeNull();
  });
  it('rejects malformed or wrong-list cursors and invalid page sizes', () => {
    for (const value of ['!', 'e30', 'x'.repeat(2049)])
      expect(() =>
        cursorCondition(value, 'files', table.time, table.id)
      ).toThrow('Invalid cursor');
    const cursor = finishPage(
      [
        {
          id: '00000000-0000-4000-8000-000000000001',
          cursorTime: '2026-09-09 12:00:00',
        },
        { id: 'extra', cursorTime: '' },
      ],
      1,
      'trash'
    ).nextCursor!;
    expect(() =>
      cursorCondition(cursor, 'files', table.time, table.id)
    ).toThrow('Invalid cursor');
    for (const limit of [0, 101, NaN, 1.5])
      expect(() => paginationOptions(1, limit)).toThrow();
    expect(cursorCondition('', 'files', table.time, table.id)).toBeUndefined();
  });
});
