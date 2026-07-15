import { describe, expect, it } from 'bun:test';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import * as schema from './schema';

describe('account deletion queue scan schema', () => {
  it('persists bounded Redis scan progress and discovered jobs', () => {
    const table = (schema as Record<string, unknown>)
      .accountDeletionQueueScans as PgTable | undefined;
    expect(table).toBeDefined();

    const config = getTableConfig(table!);
    expect(config.name).toBe('account_deletion_queue_scans');
    expect(config.columns.map(column => column.name)).toEqual([
      'user_id',
      'queue_name',
      'cursor',
      'completed',
      'pending_keys',
      'job_ids',
      'version',
      'created_at',
      'updated_at',
    ]);
    expect(config.primaryKeys[0]?.columns.map(column => column.name)).toEqual([
      'user_id',
      'queue_name',
    ]);
  });
});
