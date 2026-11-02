import { describe, expect, it } from 'bun:test';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../src/schema';

function getAiTryOnReferencesTable(): PgTable {
  const table = (schema as Record<string, unknown>).aiTryOnReferences;
  expect(table).toBeDefined();
  return table as PgTable;
}

describe('ai try-on references schema', () => {
  it('stores kind, bilingual copy, storage, provenance and ordering fields', () => {
    const config = getTableConfig(getAiTryOnReferencesTable());

    expect(config.name).toBe('ai_try_on_references');
    expect(config.columns.map(column => column.name)).toEqual([
      'id',
      'slug',
      'kind',
      'title_zh',
      'title_en',
      'description_zh',
      'description_en',
      'tags',
      'asset_bucket',
      'asset_storage_key',
      'thumbnail_bucket',
      'thumbnail_storage_key',
      'source_url',
      'license_name',
      'license_url',
      'attribution',
      'license_reviewed_at',
      'is_enabled',
      'sort_order',
      'created_at',
      'updated_at',
    ]);
  });

  it('requires identity, copy and storage columns but keeps license fields nullable', () => {
    const config = getTableConfig(getAiTryOnReferencesTable());
    const notNull = (name: string) =>
      config.columns.find(column => column.name === name)?.notNull;

    for (const required of [
      'id',
      'slug',
      'kind',
      'title_zh',
      'title_en',
      'tags',
      'asset_bucket',
      'asset_storage_key',
      'thumbnail_bucket',
      'thumbnail_storage_key',
      'is_enabled',
      'sort_order',
      'created_at',
      'updated_at',
    ]) {
      expect(notNull(required)).toBe(true);
    }

    // 许可字段可空是刻意设计:缺任何一项都视为未审查,由查询侧 fail closed 过滤。
    for (const optional of [
      'description_zh',
      'description_en',
      'source_url',
      'license_name',
      'license_url',
      'attribution',
      'license_reviewed_at',
    ]) {
      expect(notNull(optional)).toBe(false);
    }
  });

  it('restricts kind to person, pose and garment', () => {
    const kindEnum = (schema as Record<string, unknown>)
      .aiTryOnReferenceKindEnum as { enumValues: string[] };

    expect(kindEnum.enumValues).toEqual(['person', 'pose', 'garment']);
  });

  it('indexes kind with sort order for the gallery list query', () => {
    const config = getTableConfig(getAiTryOnReferencesTable());
    const index = config.indexes.find(
      candidate =>
        candidate.config.name === 'ai_try_on_references_kind_sort_idx'
    );

    expect(index?.config.columns.map(column => column.name)).toEqual([
      'kind',
      'sort_order',
    ]);
  });
});
