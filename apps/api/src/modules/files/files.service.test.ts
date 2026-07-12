import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';

let insertedFile: Record<string, unknown> | null = null;

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

mock.module('@utils-plane/db', () => ({
  db: { insert },
  files: {},
}));

const { FilesService } = await import('./files.service');

describe('FilesService upload entitlement limits', () => {
  beforeEach(() => {
    insertedFile = null;
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
