import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import type { File } from '@utils-plane/db';

let insertedFile: Record<string, unknown> | null = null;
let selectedFile: Record<string, unknown> | null = null;
let selectedRows: Record<string, unknown>[] = [];
const uploadEvents: string[] = [];
const insertSources: string[] = [];

const transactionInsert = vi.fn(() => ({
  values: vi.fn((file: Record<string, unknown>) => {
    uploadEvents.push('transaction-insert');
    insertSources.push('transaction');
    insertedFile = file;
    return { returning };
  }),
}));
const transaction = { insert: transactionInsert };
const withActiveUserTransaction = vi.fn(
  async (
    _userId: string,
    operation: (tx: typeof transaction) => Promise<unknown>
  ) => {
    uploadEvents.push('transaction');
    return operation(transaction);
  }
);
const withProducerTransaction = vi.fn(
  async (operation: (tx: typeof transaction) => Promise<unknown>) => {
    uploadEvents.push('transaction');
    return operation(transaction);
  }
);

const minioService = { delete: vi.fn() };
const cleanupQueue = {
  add: vi.fn(async () => ({ id: 'orphan-job' })),
};
const cleanupObligationService = {
  recordObject: vi.fn(async () => {
    uploadEvents.push('obligation-record');
  }),
  clear: vi.fn(async () => {
    uploadEvents.push('obligation-clear');
  }),
  release: vi.fn(async () => {
    uploadEvents.push('obligation-release');
  }),
};
const lte = vi.fn((_column: unknown, value: unknown) => value);
const eq = vi.fn((_column: unknown, value: unknown) => value);
const selectWhere = vi.fn(async () => selectedRows);
const selectFrom = vi.fn(() => ({ where: selectWhere }));
const select = vi.fn(() => ({ from: selectFrom }));
const deleteWhere = vi.fn(async () => undefined);
const deleteFrom = vi.fn(() => ({ where: deleteWhere }));

const returning = vi.fn(async () => [
  {
    id: insertedFile?.id ?? 'file-1',
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
  insertSources.push('global');
  insertedFile = file;
  return { returning };
});

const insert = vi.fn(() => ({ values }));
const findFirst = vi.fn(() => selectedFile);

mock.module('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => conditions,
  asc: vi.fn(),
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
  cleanupObligations: {
    kind: 'obligationKind',
    resourceId: 'obligationResourceId',
  },
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

mock.module('../../common/database/active-user-transaction', () => ({
  withActiveUserTransaction,
  withProducerTransaction,
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
    uploadEvents.length = 0;
    insertSources.length = 0;
    vi.clearAllMocks();
  });

  it('rejects anonymous uploads over the free shared limit', async () => {
    const minioService = {
      upload: vi.fn(),
    };
    const service = new FilesService(
      minioService as any,
      cleanupQueue as any,
      cleanupObligationService as any
    );

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

  it('records object cleanup intent before uploading to object storage', async () => {
    const minioService = {
      upload: vi.fn(async (storageKey: string) => {
        const fileId = storageKey.split('/')[1];
        expect(cleanupObligationService.recordObject).toHaveBeenCalledWith(
          fileId,
          storageKey
        );
        uploadEvents.push('upload');
      }),
      delete: vi.fn(),
    };
    const service = new FilesService(
      minioService as any,
      cleanupQueue as any,
      cleanupObligationService as any
    );

    await service.upload(
      Buffer.from('small-buffer'),
      { filename: 'paid.png', mimeType: 'image/png', size: 128 },
      { id: 'user-1', plan: 'free', role: 'user' }
    );

    expect(uploadEvents.slice(0, 2)).toEqual(['obligation-record', 'upload']);
  });

  it('releases the object lease when upload fails after intent creation', async () => {
    const uploadError = new Error('storage unavailable');
    const minioService = {
      upload: vi.fn().mockRejectedValue(uploadError),
      delete: vi.fn(),
    };
    const service = new FilesService(
      minioService as any,
      cleanupQueue as any,
      cleanupObligationService as any
    );

    await expect(
      service.upload(
        Buffer.from('small-buffer'),
        { filename: 'paid.png', mimeType: 'image/png', size: 128 },
        { id: 'user-1', plan: 'free', role: 'user' }
      )
    ).rejects.toBe(uploadError);

    const storageKey = String(minioService.upload.mock.calls[0]?.[0]);
    const fileId = storageKey.split('/')[1];
    expect(cleanupObligationService.release).toHaveBeenCalledWith(
      'object',
      fileId
    );
    expect(cleanupObligationService.clear).not.toHaveBeenCalled();
  });

  it('clears object cleanup intent only after the file row is committed', async () => {
    const minioService = {
      upload: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn(),
    };
    cleanupObligationService.clear.mockImplementationOnce(async () => {
      expect(uploadEvents).toContain('transaction-insert');
      uploadEvents.push('obligation-clear');
    });
    const service = new FilesService(
      minioService as any,
      cleanupQueue as any,
      cleanupObligationService as any
    );

    const file = await service.upload(
      Buffer.from('small-buffer'),
      { filename: 'paid.png', mimeType: 'image/png', size: 128 },
      { id: 'user-1', plan: 'free', role: 'user' }
    );

    expect(insertedFile?.id).toBe(file.id);
    expect(cleanupObligationService.clear).toHaveBeenCalledWith(
      'object',
      file.id
    );
  });

  it('uses the signed-in user plan and role for upload limits and ownership', async () => {
    const minioService = {
      upload: vi.fn(async () => {
        uploadEvents.push('upload');
        expect(withActiveUserTransaction).not.toHaveBeenCalled();
      }),
      delete: vi.fn(),
    };
    const service = new FilesService(
      minioService as any,
      cleanupQueue as any,
      cleanupObligationService as any
    );

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
    expect(withActiveUserTransaction).toHaveBeenCalledWith(
      'user-1',
      expect.any(Function)
    );
    expect(insertSources).toEqual(['transaction']);
    expect(uploadEvents).toEqual([
      'obligation-record',
      'upload',
      'transaction',
      'transaction-insert',
      'obligation-clear',
    ]);
  });

  it('uses a bounded producer transaction for anonymous uploads', async () => {
    const minioService = {
      upload: vi.fn(async () => {
        expect(withActiveUserTransaction).not.toHaveBeenCalled();
      }),
      delete: vi.fn(),
    };
    const service = new FilesService(
      minioService as any,
      cleanupQueue as any,
      cleanupObligationService as any
    );

    await service.upload(
      Buffer.from('small-buffer'),
      {
        filename: 'anonymous.png',
        mimeType: 'image/png',
        size: 128,
      },
      null
    );

    expect(withActiveUserTransaction).not.toHaveBeenCalled();
    expect(withProducerTransaction).toHaveBeenCalledWith(expect.any(Function));
    expect(insertSources).toEqual(['transaction']);
  });

  it('releases the object obligation when account deletion starts before the insert transaction', async () => {
    const deletionError = new Error('Account deletion is in progress');
    withActiveUserTransaction.mockRejectedValueOnce(deletionError);
    const minioService = {
      upload: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const service = new FilesService(
      minioService as any,
      cleanupQueue as any,
      cleanupObligationService as any
    );

    const result = service.upload(
      Buffer.from('small-buffer'),
      { filename: 'paid.png', mimeType: 'image/png', size: 128 },
      { id: 'user-1', plan: 'free', role: 'user' }
    );

    await expect(result).rejects.toBe(deletionError);
    expect(transactionInsert).not.toHaveBeenCalled();
    expect(minioService.delete).not.toHaveBeenCalled();
    expect(cleanupQueue.add).not.toHaveBeenCalled();
    expect(cleanupObligationService.clear).not.toHaveBeenCalled();
    const storageKey = String(minioService.upload.mock.calls[0]?.[0]);
    expect(cleanupObligationService.release).toHaveBeenCalledWith(
      'object',
      storageKey.split('/')[1]
    );
  });

  it('only releases the object obligation when commit outcome is ambiguous', async () => {
    const commitError = new Error('connection lost during commit');
    withActiveUserTransaction.mockImplementationOnce(
      async (_userId, operation) => {
        uploadEvents.push('transaction');
        await operation(transaction);
        uploadEvents.push('commit-ambiguous');
        throw commitError;
      }
    );
    const minioService = {
      upload: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const service = new FilesService(
      minioService as any,
      cleanupQueue as any,
      cleanupObligationService as any
    );

    await expect(
      service.upload(
        Buffer.from('small-buffer'),
        { filename: 'paid.png', mimeType: 'image/png', size: 128 },
        { id: 'user-1', plan: 'free', role: 'user' }
      )
    ).rejects.toBe(commitError);

    expect(transactionInsert).toHaveBeenCalledTimes(1);
    expect(uploadEvents).toContain('commit-ambiguous');
    expect(minioService.delete).not.toHaveBeenCalled();
    expect(cleanupQueue.add).not.toHaveBeenCalled();
    expect(cleanupObligationService.clear).not.toHaveBeenCalled();
    expect(cleanupObligationService.release).toHaveBeenCalledWith(
      'object',
      insertedFile?.id
    );
  });

  it('releases the object obligation when inserting the file record fails', async () => {
    const databaseError = new Error('database unavailable');
    returning.mockRejectedValueOnce(databaseError);
    const minioService = {
      upload: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const service = new FilesService(
      minioService as any,
      cleanupQueue as any,
      cleanupObligationService as any
    );

    const result = service.upload(
      Buffer.from('small-buffer'),
      {
        filename: 'paid.png',
        mimeType: 'image/png',
        size: 128,
      },
      { id: 'user-1', plan: 'free', role: 'user' }
    );

    await expect(result).rejects.toBe(databaseError);
    expect(minioService.delete).not.toHaveBeenCalled();
    expect(cleanupQueue.add).not.toHaveBeenCalled();
    expect(cleanupObligationService.clear).not.toHaveBeenCalled();
    expect(cleanupObligationService.release).toHaveBeenCalledWith(
      'object',
      insertedFile?.id
    );
  });

  it('releases the object obligation when insert returning is empty', async () => {
    returning.mockResolvedValueOnce([]);
    const minioService = {
      upload: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const service = new FilesService(
      minioService as any,
      cleanupQueue as any,
      cleanupObligationService as any
    );

    await expect(
      service.upload(
        Buffer.from('small-buffer'),
        {
          filename: 'paid.png',
          mimeType: 'image/png',
          size: 128,
        },
        { id: 'user-1', plan: 'free', role: 'user' }
      )
    ).rejects.toThrow('Failed to create file record');

    expect(minioService.delete).not.toHaveBeenCalled();
    expect(cleanupQueue.add).not.toHaveBeenCalled();
    expect(cleanupObligationService.clear).not.toHaveBeenCalled();
    expect(cleanupObligationService.release).toHaveBeenCalledWith(
      'object',
      insertedFile?.id
    );
  });

  it('does not depend on direct storage cleanup after a database failure', async () => {
    const databaseError = new Error('database unavailable');
    returning.mockRejectedValueOnce(databaseError);
    const minioService = {
      upload: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockRejectedValue(new Error('storage unavailable')),
    };
    const service = new FilesService(
      minioService as any,
      cleanupQueue as any,
      cleanupObligationService as any
    );

    const result = service.upload(
      Buffer.from('small-buffer'),
      {
        filename: 'private-name.png',
        mimeType: 'image/png',
        size: 128,
      },
      { id: 'user-1', plan: 'free', role: 'user' }
    );

    await expect(result).rejects.toBe(databaseError);
    const storageKey = String(minioService.upload.mock.calls[0]?.[0]);
    const fileId = storageKey.split('/')[1];
    expect(minioService.delete).not.toHaveBeenCalled();
    expect(cleanupQueue.add).not.toHaveBeenCalled();
    expect(cleanupObligationService.clear).not.toHaveBeenCalled();
    expect(cleanupObligationService.release).toHaveBeenCalledWith(
      'object',
      fileId
    );
  });

  it('keeps the original error when releasing the object obligation fails', async () => {
    const databaseError = new Error('database unavailable');
    returning.mockRejectedValueOnce(databaseError);
    cleanupObligationService.release.mockRejectedValueOnce(
      new Error('database unavailable')
    );
    const minioService = {
      upload: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockRejectedValue(new Error('storage unavailable')),
    };
    const service = new FilesService(
      minioService as any,
      cleanupQueue as any,
      cleanupObligationService as any
    );
    const logError = vi
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => undefined);

    const result = service.upload(
      Buffer.from('small-buffer'),
      {
        filename: 'private-name.png',
        mimeType: 'image/png',
        size: 128,
      },
      { id: 'user-1', plan: 'free', role: 'user' }
    );

    await expect(result).rejects.toBe(databaseError);
    const storageKey = String(minioService.upload.mock.calls[0]?.[0]);
    const fileId = storageKey.split('/')[1];
    expect(logError).toHaveBeenCalledWith(
      `Failed to release object cleanup obligation for file ${fileId}`
    );
    expect(JSON.stringify(logError.mock.calls)).not.toContain(storageKey);
    expect(cleanupObligationService.recordObject).toHaveBeenCalledWith(
      fileId,
      storageKey
    );
    expect(cleanupObligationService.clear).not.toHaveBeenCalled();
    expect(minioService.delete).not.toHaveBeenCalled();
    expect(cleanupQueue.add).not.toHaveBeenCalled();
  });

  it('returns the committed file when clearing its durable intent fails', async () => {
    cleanupObligationService.clear.mockRejectedValueOnce(
      new Error('database unavailable')
    );
    const minioService = {
      upload: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn(),
    };
    const service = new FilesService(
      minioService as any,
      cleanupQueue as any,
      cleanupObligationService as any
    );
    const logError = vi
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => undefined);

    const file = await service.upload(
      Buffer.from('small-buffer'),
      { filename: 'private-name.png', mimeType: 'image/png', size: 128 },
      { id: 'user-1', plan: 'free', role: 'user' }
    );

    expect(file.id).toBe(insertedFile?.id);
    expect(logError).toHaveBeenCalledWith(
      `Failed to clear object cleanup obligation for file ${file.id}`
    );
    expect(JSON.stringify(logError.mock.calls)).not.toContain(file.storageKey);
  });

  it('does not compensate an object after the file transaction committed', async () => {
    const minioService = {
      upload: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const service = new FilesService(
      minioService as any,
      cleanupQueue as any,
      cleanupObligationService as any
    );
    vi.spyOn((service as any).logger, 'log').mockImplementation(() => {
      throw new Error('logger failed');
    });

    await expect(
      service.upload(
        Buffer.from('small-buffer'),
        { filename: 'paid.png', mimeType: 'image/png', size: 128 },
        { id: 'user-1', plan: 'free', role: 'user' }
      )
    ).rejects.toThrow('logger failed');

    expect(transactionInsert).toHaveBeenCalledTimes(1);
    expect(minioService.delete).not.toHaveBeenCalled();
    expect(cleanupQueue.add).not.toHaveBeenCalled();
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
    const service = new FilesService(
      { upload: vi.fn() } as any,
      cleanupQueue as any
    );

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
    const service = new FilesService(
      { upload: vi.fn() } as any,
      cleanupQueue as any
    );

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
    const service = new FilesService(minioService as any, cleanupQueue as any);

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
    const service = new FilesService(minioService as any, cleanupQueue as any);

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
    const service = new FilesService(minioService as any, cleanupQueue as any);
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
    const service = new FilesService(minioService as any, cleanupQueue as any);

    const result = await service.cleanupExpired(
      new Date('2026-07-13T00:00:00.000Z')
    );

    expect(minioService.delete).toHaveBeenCalledTimes(1);
    expect(deleteWhere).toHaveBeenCalledWith('file-1');
    expect(result.deletedFileIds).toEqual(['file-1']);
    expect(result.failedFileIds).toEqual([]);
  });
});
