import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import { Readable } from 'node:stream';

// 图库查询对许可 fail close:kind / is_enabled / 四项许可字段必须同时满足。
// 用 drizzle 操作符的 mock 精确断言 where 条件,db 链用桩数据驱动。
const and = vi.fn((...conditions: unknown[]) => ({ kind: 'and', conditions }));
const asc = vi.fn((column: unknown) => ({ kind: 'asc', column }));
const eq = vi.fn((column: unknown, value: unknown) => ({
  kind: 'eq',
  column,
  value,
}));
const isNotNull = vi.fn((column: unknown) => ({
  kind: 'isNotNull',
  column,
}));

mock.module('drizzle-orm', () => ({
  and,
  asc,
  eq,
  isNotNull,
}));

const table = {
  id: 'id',
  slug: 'slug',
  kind: 'kind',
  titleZh: 'title_zh',
  titleEn: 'title_en',
  descriptionZh: 'description_zh',
  descriptionEn: 'description_en',
  tags: 'tags',
  assetBucket: 'asset_bucket',
  assetStorageKey: 'asset_storage_key',
  thumbnailBucket: 'thumbnail_bucket',
  thumbnailStorageKey: 'thumbnail_storage_key',
  sourceUrl: 'source_url',
  licenseName: 'license_name',
  attribution: 'attribution',
  licenseReviewedAt: 'license_reviewed_at',
  isEnabled: 'is_enabled',
  sortOrder: 'sort_order',
};

let listRows: Record<string, unknown>[] = [];
let lookupRows: Record<string, unknown>[] = [];
const orderBy = vi.fn(async () => listRows);
const limit = vi.fn(async () => lookupRows);
const where = vi.fn(() => ({ orderBy, limit }));
const from = vi.fn(() => ({ where }));
const select = vi.fn(() => ({ from }));

mock.module('@utils-plane/db', () => ({
  db: { select },
  aiTryOnReferences: table,
}));

const { AiTryOnReferenceUnavailableError, AiTryOnReferencesService } =
  await import('../../../../src/modules/tasks/services/ai-try-on-references.service');

function referenceRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    kind: 'person',
    titleZh: '正面站姿人像',
    titleEn: 'Front-standing model',
    descriptionZh: '中性剪影',
    descriptionEn: 'Neutral silhouette',
    tags: ['frontal', 'standing'],
    assetBucket: 'try-on-references',
    assetStorageKey: 'person/front.png',
    thumbnailBucket: 'try-on-references',
    thumbnailStorageKey: 'thumbnails/person/front.png',
    sourceUrl: 'https://github.com/juzhiqiang/unitls-plane',
    licenseName: 'CC0-1.0',
    attribution: 'Utils-Plane',
    licenseReviewedAt: new Date('2026-11-02T00:00:00.000Z'),
    sortOrder: 0,
    ...overrides,
  };
}

function stubClient(send: (...args: unknown[]) => Promise<unknown>) {
  const service = new AiTryOnReferencesService();
  (service as unknown as { client: unknown }).client = { send };
  return service;
}

beforeEach(() => {
  vi.clearAllMocks();
  listRows = [];
  lookupRows = [];
  delete process.env.S3_PUBLIC_URL;
  delete process.env.NEXT_PUBLIC_S3_PUBLIC_URL;
});

describe('AiTryOnReferencesService list', () => {
  it('filters by kind and fails closed on enabled + license fields', async () => {
    listRows = [referenceRow()];
    const service = new AiTryOnReferencesService();

    await service.list('person', 'zh');

    expect(select).toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith(table.kind, 'person');
    expect(eq).toHaveBeenCalledWith(table.isEnabled, true);
    expect(isNotNull).toHaveBeenCalledWith(table.sourceUrl);
    expect(isNotNull).toHaveBeenCalledWith(table.licenseName);
    expect(isNotNull).toHaveBeenCalledWith(table.attribution);
    expect(isNotNull).toHaveBeenCalledWith(table.licenseReviewedAt);
    expect(orderBy).toHaveBeenCalledWith(
      { kind: 'asc', column: table.sortOrder },
      { kind: 'asc', column: table.id }
    );
  });

  it('returns the requested language and never exposes bucket or key', async () => {
    process.env.S3_PUBLIC_URL = 'https://cdn.example.com/';
    listRows = [
      referenceRow(),
      referenceRow({ id: 'row-2', kind: 'pose', sortOrder: 1 }),
    ];
    const service = new AiTryOnReferencesService();

    const zh = await service.list('pose', 'zh');
    expect(zh).toHaveLength(2);
    expect(zh[0]).toEqual({
      id: '11111111-1111-1111-1111-111111111111',
      kind: 'person',
      title: '正面站姿人像',
      description: '中性剪影',
      tags: ['frontal', 'standing'],
      thumbnailUrl:
        'https://cdn.example.com/try-on-references/thumbnails/person/front.png',
      sourceUrl: 'https://github.com/juzhiqiang/unitls-plane',
      licenseName: 'CC0-1.0',
      attribution: 'Utils-Plane',
      sortOrder: 0,
    });

    const en = await service.list('person', 'en');
    expect(en[0]?.title).toBe('Front-standing model');
    expect(en[0]?.description).toBe('Neutral silhouette');
    for (const item of [...zh, ...en]) {
      expect(Object.keys(item)).not.toContain('assetBucket');
      expect(Object.keys(item)).not.toContain('assetStorageKey');
      expect(Object.keys(item)).not.toContain('thumbnailBucket');
      expect(Object.keys(item)).not.toContain('thumbnailStorageKey');
    }
  });

  it('falls back to NEXT_PUBLIC_S3_PUBLIC_URL and to null when unconfigured', async () => {
    listRows = [referenceRow()];
    const service = new AiTryOnReferencesService();

    process.env.NEXT_PUBLIC_S3_PUBLIC_URL = 'https://minio.example.com';
    expect((await service.list('person', 'zh'))[0]?.thumbnailUrl).toBe(
      'https://minio.example.com/try-on-references/thumbnails/person/front.png'
    );

    delete process.env.NEXT_PUBLIC_S3_PUBLIC_URL;
    expect((await service.list('person', 'zh'))[0]?.thumbnailUrl).toBeNull();
  });

  it('defaults missing tags and descriptions to empty values', async () => {
    listRows = [referenceRow({ tags: null, descriptionZh: null })];
    const service = new AiTryOnReferencesService();

    const [item] = await service.list('person', 'zh');
    expect(item?.tags).toEqual([]);
    expect(item?.description).toBeNull();
  });
});

describe('AiTryOnReferencesService getImageForGeneration', () => {
  it('reads the asset object from the row bucket and key', async () => {
    lookupRows = [referenceRow()];
    const send = vi.fn(async () => ({
      Body: Readable.from([Buffer.from('png-bytes')]),
    }));
    const service = stubClient(send);

    const buffer = await service.getImageForGeneration(
      '11111111-1111-1111-1111-111111111111',
      'person'
    );

    expect(buffer.toString()).toBe('png-bytes');
    expect(eq).toHaveBeenCalledWith(
      table.id,
      '11111111-1111-1111-1111-111111111111'
    );
    expect(eq).toHaveBeenCalledWith(table.kind, 'person');
    expect(eq).toHaveBeenCalledWith(table.isEnabled, true);
    const command = send.mock.calls[0]?.[0] as { input: unknown };
    expect(command.input).toEqual({
      Bucket: 'try-on-references',
      Key: 'person/front.png',
    });
  });

  it('rejects a missing, disabled or license-incomplete row without reading storage', async () => {
    lookupRows = [];
    const send = vi.fn();
    const service = stubClient(send);

    await expect(
      service.getImageForGeneration('missing', 'person')
    ).rejects.toThrow(AiTryOnReferenceUnavailableError);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects a kind mismatch', async () => {
    // DB 层按 kind 过滤后查不到行: garment 资产不能被 person 角色解析。
    lookupRows = [];
    const send = vi.fn();
    const service = stubClient(send);

    await expect(
      service.getImageForGeneration(
        '11111111-1111-1111-1111-111111111111',
        'pose'
      )
    ).rejects.toThrow(AiTryOnReferenceUnavailableError);
    expect(eq).toHaveBeenCalledWith(table.kind, 'pose');
    expect(send).not.toHaveBeenCalled();
  });

  it('propagates object storage read failures', async () => {
    lookupRows = [referenceRow()];
    const send = vi.fn(async () => {
      throw new Error('NoSuchKey');
    });
    const service = stubClient(send);

    await expect(
      service.getImageForGeneration(
        '11111111-1111-1111-1111-111111111111',
        'person'
      )
    ).rejects.toThrow('NoSuchKey');
  });
});
