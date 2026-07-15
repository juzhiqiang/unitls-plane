import { expect, test } from 'bun:test';
import { getTableColumns } from 'drizzle-orm';
import { files } from './schema';

test('files schema persists a nullable purge marker', () => {
  const columns = getTableColumns(files) as Record<
    string,
    { name: string; notNull: boolean } | undefined
  >;

  expect(columns.purgeStartedAt).toBeDefined();
  expect(columns.purgeStartedAt?.name).toBe('purge_started_at');
  expect(columns.purgeStartedAt?.notNull).toBe(false);
});
