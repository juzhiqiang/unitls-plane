import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import type { File } from '@utils-plane/db';

let insertedFile: Record<string, unknown> | null = null;
let selectedFile: Record<string, unknown> | null = null;
let selectedRows: Record<string, unknown>[] = [];

const minioService = { delete: vi.fn() };
const lte = vi.fn((_column: unknown, value: unknown) => value);
const eq = vi.fn((_column: unknown, value: unknown) => value);
const selectWhere = vi.fn(async () => selectedRows);
const selectFrom = vi.fn(() => ({ where: selectWhere }));
const select = vi.fn(() => ({ from: selectFrom }));
const deleteWhere = vi.fn(async () => undefined);
const deleteFrom = vi.fn(() => ({ where: deleteWhere }));

const returning = vi.fn(() => [
  {
    id: 'file-1',
    userId: insertedFile?.userId ?? null,
    filename: insertedFile?.filename,
    originalSize: insertedFile?.originalSize,
    storageKey: insertedFile?.storageKey,
    mimeType: insertedFile?.mimeType,
    expiresAt: insertedFile?.expiresAt,
    deletedAt: null,
    createdAt: new Date('2026-07-12T00:00:00.000Z'),
  },
]);

const values = vi.fn((file: Record<string, unknown>) => {
  insertedFile = file;
  return { returning };
});

const insert = vi.fn(() => ({ values }));
const findFirst = vi.fn(() => selectedFile);

mock.module('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => conditions,
  desc: vi.fn(),
  eq,
  gte: vi.fn(),
  inArray: vi.fn(),
  isNotNull: (column: unknown) => column,
  isNull: (column: unknown) => column,
  like: vi.fn(),
  lte,
  sql: vi.fn(),
}));

mock.module('@utils-plane/db', () => ({
  db: {
    insert,
    select,
    delete: deleteFrom,
    query: { files: { findFirst } },
  },
  files: {
    id: 'id',
    userId: 'userId',
    expiresAt: 'expiresAt',
    deletedAt: 'deletedAt',
  },
  tasks: {},
}));

const { FilesService } = await import('./files.service');

const baseFile: File = {
  id: 'file-1',
  userId: null,
  filename: 'report.pdf',
  originalSize: 128,
  storageKey: 'anonymous/file-1/report.pdf',
  bucket: 'uploads',
  mimeType: 'application/pdf',
  metadata: null,
  expiresAt: new Date('2026-07-13T00:00:00.000Z'),
  deletedAt: null,
  createdAt: new Date('2026-07-12T00:00:00.000Z'),
  updatedAt: new Date('2026-07-12T00:00:00.000Z'),
};

function anonymousFile(overrides: Partial<File> = {}): File {
  return { ...baseFile, ...overrides };
}

function userFile(overrides: Partial<File> = {}): File {
  return {
    ...baseFile,
    userId: 'user-1',
    storageKey: 'user-1/file-1/report.pdf',
    expiresAt: null,
    deletedAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('FilesService upload entitlement limits', () => {
  beforeEach(() => {
    insertedFile = null;
    selectedFile = null;
    vi.clearAllMocks();
  });

  it('rejects anonymous uploads over the free shared limit', async () => {
    const minioService = {
      upload: vi.fn(),
    };
    const service = new FilesService(minioService as any);

    await expect(
      service.upload(
        Buffer.from('small-buffer'),
        {
          filename: 'large.png',
          mimeType: 'image/png',
          size: 11 * 1024 * 1024,
        },
        null
      )
    ).rejects.toThrow('File size exceeds limit of 10MB');

    expect(minioService.upload).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('uses the signed-in user plan and role for upload limits and ownership', async () => {
    const minioService = {
      upload: vi.fn(),
    };
    const service = new FilesService(minioService as any);

    const file = await service.upload(
      Buffer.from('small-buffer'),
      {
        filename: 'paid.png',
        mimeType: 'image/png',
        size: 80 * 1024 * 1024,
      },
      { id: 'user-1', plan: 'pro', role: 'user' }
    );

    expect(file.userId).toBe('user-1');
    expect(insertedFile?.userId).toBe('user-1');
    expect(insertedFile?.expiresAt).toBeNull();
    expect(minioService.upload).toHaveBeenCalledWith(
      expect.stringContaining('user-1/'),
      Buffer.from('small-buffer'),
      'image/png'
    );
  });
});

describe('FilesService file access checks', () => {
  beforeEach(() => {
    insertedFile = null;
    selectedFile = null;
    vi.clearAllMocks();
  });

  it('allows anonymous access to anonymous files', async () => {
    selectedFile = {
      id: 'file-1',
      userId: null,
      filename: 'public.png',
      originalSize: 12,
      storageKey: 'anonymous/file-1/public.png',
      mimeType: 'image/png',
      expiresAt: null,
      deletedAt: null,
      createdAt: new Date('2026-07-12T00:00:00.000Z'),
    };
    const service = new FilesService({ upload: vi.fn() } as any);

    await expect(service.getById('file-1')).resolves.toMatchObject({
      id: 'file-1',
      userId: null,
    });
  });

  it('rejects user-owned files when no current user is provided', async () => {
    selectedFile = {
      id: 'file-1',
      userId: 'user-1',
      filename: 'private.png',
      originalSize: 12,
      storageKey: 'user-1/file-1/private.png',
      mimeType: 'image/png',
      expiresAt: null,
      deletedAt: null,
      createdAt: new Date('2026-07-12T00:00:00.000Z'),
    };
    const service = new FilesService({ upload: vi.fn() } as any);

    const anonymousError = await service
      .getById('file-1')
      .catch((error: unknown) => error as Error);
    expect(anonymousError).toBeInstanceOf(Error);
    expect(String(anonymousError)).toContain('Access denied');

    const otherUserError = await service
      .getById('file-1', 'user-2')
      .catch((error: unknown) => error as Error);
    expect(otherUserError).toBeInstanceOf(Error);
    expect(String(otherUserError)).toContain('Access denied');

    await expect(service.getById('file-1', 'user-1')).resolves.toMatchObject({
      id: 'file-1',
      userId: 'user-1',
    });
  });
});

describe('FilesService retention cleanup', () => {
  beforeEach(() => {
    selectedRows = [];
    vi.clearAllMocks();
    minioService.delete.mockResolvedValue(undefined);
  });

  it('deletes anonymous files that expire exactly at the cleanup boundary', async () => {
    const now = new Date('2026-07-13T00:00:00.000Z');
    selectedRows = [anonymousFile({ expiresAt: now })];
    const service = new FilesService(minioService as any);

    const result = await service.cleanupExpired(now);

    expect(lte).toHaveBeenCalledWith('expiresAt', now);
    expect(selectWhere).toHaveBeenCalledWith([
      'userId',
      'deletedAt',
      'expiresAt',
      now,
    ]);
    expect(minioService.delete).toHaveBeenCalledWith(
      'anonymous/file-1/report.pdf'
    );
    expect(deleteWhere).toHaveBeenCalledWith('file-1');
    expect(result).toEqual({
      scanned: 1,
      deleted: 1,
      failed: 0,
      deletedFileIds: ['file-1'],
      failedFileIds: [],
    });
  });

  it('deletes trashed files after the 30-day retention boundary', async () => {
    const now = new Date('2026-07-31T00:00:00.000Z');
    const cutoff = new Date('2026-07-01T00:00:00.000Z');
    selectedRows = [userFile({ deletedAt: cutoff })];
    const service = new FilesService(minioService as any);

    const result = await service.cleanupTrashed(now);

    expect(lte).toHaveBeenCalledWith('deletedAt', cutoff);
    expect(selectWhere).toHaveBeenCalledWith(['deletedAt', cutoff]);
    expect(result).toEqual({
      scanned: 1,
      deleted: 1,
      failed: 0,
      deletedFileIds: ['file-1'],
      failedFileIds: [],
    });
  });

  it('keeps the database row when object deletion fails', async () => {
    selectedRows = [anonymousFile()];
    minioService.delete.mockRejectedValueOnce(new Error('storage unavailable'));
    const service = new FilesService(minioService as any);
    vi.spyOn((service as any).logger, 'error').mockImplementation(() => {});

    const result = await service.cleanupExpired(
      new Date('2026-07-13T00:00:00.000Z')
    );

    expect(deleteWhere).not.toHaveBeenCalled();
    expect(result).toEqual({
      scanned: 1,
      deleted: 0,
      failed: 1,
      deletedFileIds: [],
      failedFileIds: ['file-1'],
    });
  });

  it('deletes the database row when DeleteObject succeeds idempotently', async () => {
    selectedRows = [anonymousFile()];
    const service = new FilesService(minioService as any);

    const result = await service.cleanupExpired(
      new Date('2026-07-13T00:00:00.000Z')
    );

    expect(minioService.delete).toHaveBeenCalledTimes(1);
    expect(deleteWhere).toHaveBeenCalledWith('file-1');
    expect(result.deletedFileIds).toEqual(['file-1']);
    expect(result.failedFileIds).toEqual([]);
  });
});
