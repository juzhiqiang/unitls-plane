import { describe, expect, it } from 'bun:test';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { files } from './schema/files';

function getFilenameTrigramIndex() {
  return getTableConfig(files).indexes.find(
    index => index.config.name === 'files_filename_trgm_idx'
  );
}

describe('file filename search schema', () => {
  it('defines a GIN trigram index for filename', () => {
    const index = getFilenameTrigramIndex();
    const column = index?.config.columns[0] as
      | { name?: string; indexConfig?: { opClass?: string } }
      | undefined;

    expect(index).toBeDefined();
    expect(index?.config.method).toBe('gin');
    expect(column?.name).toBe('filename');
    expect(column?.indexConfig?.opClass).toBe('gin_trgm_ops');
  });

  it('ships an idempotent migration without changing business data', () => {
    const migrationFiles = readdirSync(join(import.meta.dir, '../drizzle'))
      .filter(name => /^\d+_.+\.sql$/.test(name))
      .map(name =>
        readFileSync(join(import.meta.dir, '../drizzle', name), 'utf8')
      );
    const matchingMigrations = migrationFiles.filter(migration =>
      migration.includes('files_filename_trgm_idx')
    );
    const migration = matchingMigrations[0] ?? '';

    expect(matchingMigrations).toHaveLength(1);
    expect(migration).toMatch(
      /CREATE EXTENSION IF NOT EXISTS\s+(?:"pg_trgm"|pg_trgm)\s*;/i
    );
    expect(migration).toMatch(
      /CREATE INDEX IF NOT EXISTS\s+"files_filename_trgm_idx"\s+ON\s+"files"\s+USING\s+gin\s*\(\s*"filename"\s+gin_trgm_ops\s*\)\s*;/i
    );
    expect(migration).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER TABLE)\b/i
    );
  });

  it('verifies the extension and index in the local performance check', () => {
    const verificationScript = readFileSync(
      join(
        import.meta.dir,
        '../../../apps/api/src/scripts/verify-performance.ts'
      ),
      'utf8'
    );

    expect(verificationScript).toContain("extname = 'pg_trgm'");
    expect(verificationScript).toContain(
      "indexname = 'files_filename_trgm_idx'"
    );
    expect(verificationScript).toMatch(
      /if\s*\(\s*\(await child\.exited\)\s*!==\s*0\s*\)/
    );
  });
});
