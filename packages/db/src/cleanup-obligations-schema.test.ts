import { describe, expect, it } from 'bun:test';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as schema from './schema';

function getCleanupObligationsTable(): PgTable {
  const table = (schema as Record<string, unknown>).cleanupObligations;
  expect(table).toBeDefined();
  return table as PgTable;
}

describe('cleanup obligations schema', () => {
  it('exports the persistent cleanup obligation ledger fields', () => {
    const config = getTableConfig(getCleanupObligationsTable());

    expect(config.name).toBe('cleanup_obligations');
    expect(config.columns.map(column => column.name)).toEqual([
      'id',
      'kind',
      'state',
      'resource_id',
      'storage_key',
      'queue_name',
      'job_id',
      'reconcile_after',
      'created_at',
    ]);
    expect(config.columns.find(column => column.name === 'kind')?.notNull).toBe(
      true
    );
    expect(
      config.columns.find(column => column.name === 'state')?.notNull
    ).toBe(true);
    expect(
      config.columns.find(column => column.name === 'resource_id')?.notNull
    ).toBe(true);
    expect(
      config.columns.find(column => column.name === 'storage_key')?.notNull
    ).toBe(false);
    expect(
      config.columns.find(column => column.name === 'queue_name')?.notNull
    ).toBe(false);
    expect(
      config.columns.find(column => column.name === 'job_id')?.notNull
    ).toBe(false);
  });

  it('indexes the time when obligations become safe to reconcile', () => {
    const config = getTableConfig(getCleanupObligationsTable());
    const index = config.indexes.find(
      candidate =>
        candidate.config.name === 'cleanup_obligations_reconcile_after_idx'
    );

    expect(
      config.columns.find(column => column.name === 'reconcile_after')?.notNull
    ).toBe(true);
    expect(index?.config.columns.map(column => column.name)).toEqual([
      'reconcile_after',
    ]);
  });

  it('allows only one obligation for each kind and resource', () => {
    const config = getTableConfig(getCleanupObligationsTable());
    const index = config.indexes.find(
      candidate =>
        candidate.config.name === 'cleanup_obligations_kind_resource_idx'
    );

    expect(index?.config.unique).toBe(true);
    expect(index?.config.columns.map(column => column.name)).toEqual([
      'kind',
      'resource_id',
    ]);
  });

  it('constrains payload columns to the selected obligation kind', () => {
    const config = getTableConfig(getCleanupObligationsTable());

    expect(config.checks.map(check => check.name)).toContain(
      'cleanup_obligations_payload_check'
    );
  });

  it('backfills existing object obligations before enabling the state check', () => {
    const migration = readFileSync(
      join(import.meta.dir, '../drizzle/0012_yummy_hawkeye.sql'),
      'utf8'
    );
    const backfill = migration.indexOf(`WHEN "kind" = 'object' THEN 'cleanup'`);
    const notNull = migration.indexOf('ALTER COLUMN "state" SET NOT NULL');
    const payloadCheck = migration.lastIndexOf(
      'ADD CONSTRAINT "cleanup_obligations_payload_check"'
    );

    expect(backfill).toBeGreaterThan(-1);
    expect(backfill).toBeLessThan(notNull);
    expect(notNull).toBeLessThan(payloadCheck);
  });
});
