import { BadRequestException } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { createHash } from 'node:crypto';

function scopeKey(scope: string) {
  return createHash('sha256').update(scope).digest('hex');
}

const cursorSchema = z.object({
  scope: z.string(),
  time: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?$/),
  id: z.string().uuid(),
});

export function parseIncludeTotal(value: unknown): boolean {
  if (value === undefined || value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new BadRequestException('Invalid includeTotal');
}

export function paginationOptions(page = 1, limit = 20) {
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger((page - 1) * limit)
  ) {
    throw new BadRequestException('Invalid page or limit');
  }
  return { page, limit, offset: (page - 1) * limit };
}

/** 保留 PostgreSQL 微秒精度；不经过 JavaScript Date 的毫秒截断。 */
export function cursorCondition(
  cursor: string | undefined,
  scope: string,
  time: AnyPgColumn,
  id: AnyPgColumn
): SQL | undefined {
  if (cursor === undefined || cursor === '') return undefined;
  try {
    if (cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor))
      throw new Error();
    const value = cursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    );
    const parsed = new Date(value.time + 'Z');
    if (
      value.scope !== scopeKey(scope) ||
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value.time.slice(0, 10)
    )
      throw new Error();
    return sql`(${time}, ${id}) < (${value.time}::timestamp, ${value.id}::uuid)`;
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}

export function finishPage<T extends { id: string; cursorTime: string }>(
  rows: T[],
  limit: number,
  scope: string
) {
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(({ cursorTime, ...row }) => {
      void cursorTime;
      return row;
    }),
    nextCursor:
      hasMore && last
        ? Buffer.from(
            JSON.stringify({
              scope: scopeKey(scope),
              time: last.cursorTime,
              id: last.id,
            })
          ).toString('base64url')
        : null,
  };
}
