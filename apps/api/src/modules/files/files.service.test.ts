import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';

let insertedFile: Record<string, unknown> | null = null;
let selectedFile: Record<string, unknown> | null = null;

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
  and: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
  gte: vi.fn(),
  inArray: vi.fn(),
  isNotNull: vi.fn(),
  isNull: vi.fn(),
  like: vi.fn(),
  sql: vi.fn(),
}));

mock.module('@utils-plane/db', () => ({
  db: { insert, query: { files: { findFirst } } },
  files: { id: 'id' },
  tasks: {},
}));

const { FilesService } = await import('./files.service');

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
