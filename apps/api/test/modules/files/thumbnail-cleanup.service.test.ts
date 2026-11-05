import { afterAll, beforeEach, describe, expect, it, mock, vi } from 'bun:test';

const existingId = '00000000-0000-4000-8000-000000000001';
const missingId = '00000000-0000-4000-8000-000000000002';
const secondMissingId = '00000000-0000-4000-8000-000000000003';
const where = vi.fn(async () => [{ id: existingId }]);
const select = vi.fn(() => ({ from: () => ({ where }) }));
mock.module('@utils-plane/db', () => ({ db: { select }, files: { id: 'id' } }));
mock.module('drizzle-orm', () => ({
  inArray: (column: unknown, ids: string[]) => ({ column, ids }),
}));

const { ThumbnailCleanupService } =
  await import('../../../src/modules/files/thumbnail-cleanup.service');

describe('ThumbnailCleanupService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    where.mockImplementation(async () => [{ id: existingId }]);
  });

  it('preserves every existing file including trash and deletes only recognized orphan thumbnails', async () => {
    const minio = {
      listObjects: vi.fn(async () => ({
        objects: [
          { key: `thumbnails/${existingId}/1-320.webp` },
          { key: `thumbnails/${missingId}/1-320.webp` },
          { key: `thumbnails/${missingId}/2-640.webp` },
          { key: 'thumbnails/not-a-file/private.webp' },
          { key: `thumbnails/${missingId}/not-a-thumbnail.pdf` },
        ],
        continuationToken: 'next-page',
      })),
      delete: vi.fn(async () => undefined),
    };
    const result = await new ThumbnailCleanupService(
      minio as never
    ).cleanupPage('previous-page');
    expect(minio.listObjects).toHaveBeenCalledWith(
      'thumbnails/',
      'previous-page'
    );
    expect(where).toHaveBeenCalledWith({
      column: 'id',
      ids: [existingId, missingId],
    });
    expect(minio.delete.mock.calls).toEqual([
      [`thumbnails/${missingId}/1-320.webp`],
      [`thumbnails/${missingId}/2-640.webp`],
    ]);
    expect(result).toEqual({
      scanned: 5,
      deleted: 2,
      failed: 0,
      continuationToken: 'next-page',
    });
  });

  it('continues the page after one storage failure without treating it as deleted', async () => {
    const minio = {
      listObjects: vi.fn(async () => ({
        objects: [
          { key: `thumbnails/${missingId}/1-320.webp` },
          { key: `thumbnails/${secondMissingId}/1-320.webp` },
        ],
      })),
      delete: vi
        .fn()
        .mockRejectedValueOnce(new Error('storage unavailable'))
        .mockResolvedValueOnce(undefined),
    };
    expect(
      await new ThumbnailCleanupService(minio as never).cleanupPage()
    ).toEqual({
      scanned: 2,
      deleted: 1,
      failed: 1,
      continuationToken: undefined,
    });
    expect(minio.delete).toHaveBeenCalledTimes(2);
  });

  it('fails closed without any storage deletion when the authoritative database is unavailable', async () => {
    where.mockRejectedValueOnce(new Error('database unavailable'));
    const minio = {
      listObjects: vi.fn(async () => ({
        objects: [{ key: `thumbnails/${missingId}/1-320.webp` }],
      })),
      delete: vi.fn(),
    };
    await expect(
      new ThumbnailCleanupService(minio as never).cleanupPage()
    ).rejects.toThrow('database unavailable');
    expect(minio.delete).not.toHaveBeenCalled();
  });

  it('finishes an empty page without querying the database', async () => {
    const minio = {
      listObjects: vi.fn(async () => ({ objects: [] })),
      delete: vi.fn(),
    };
    expect(
      await new ThumbnailCleanupService(minio as never).cleanupPage()
    ).toEqual({
      scanned: 0,
      deleted: 0,
      failed: 0,
      continuationToken: undefined,
    });
    expect(select).not.toHaveBeenCalled();
  });
});

afterAll(() => mock.restore());
