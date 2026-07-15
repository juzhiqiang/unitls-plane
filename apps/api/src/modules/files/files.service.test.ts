import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import type { File } from '@utils-plane/db';

let insertedFile: Record<string, unknown> | null = null;
let selectedFile: Record<string, unknown> | null = null;
let selectedRows: Record<string, unknown>[] = [];
let lockedRows: Record<string, unknown>[] = [];
let restoredRows: { id: string }[] = [];
let transactionUpdatedRows: Record<string, unknown>[] = [];
let transactionDeletedRows: { id: string }[] = [];
const uploadEvents: string[] = [];
const insertSources: string[] = [];
const deletionEvents: string[] = [];

const transactionInsert = vi.fn(() => ({
  values: vi.fn((file: Record<string, unknown>) => {
    uploadEvents.push('transaction-insert');
    insertSources.push('transaction');
    insertedFile = file;
    return { returning };
  }),
}));
const transactionLock = vi.fn(async () => lockedRows);
const transactionSelectLimit = vi.fn(() => ({ for: transactionLock }));
const transactionSelectWhere = vi.fn(() => ({
  for: transactionLock,
  limit: transactionSelectLimit,
}));
const transactionSelectFrom = vi.fn(() => ({ where: transactionSelectWhere }));
const transactionSelect = vi.fn(() => ({ from: transactionSelectFrom }));
const transactionUpdateReturning = vi.fn(async () => {
  deletionEvents.push('marker-set');
  return transactionUpdatedRows;
});
const transactionUpdateWhere = vi.fn(() => ({
  returning: transactionUpdateReturning,
}));
const transactionUpdateSet = vi.fn(() => ({ where: transactionUpdateWhere }));
const transactionUpdate = vi.fn(() => ({ set: transactionUpdateSet }));
const transactionDeleteReturning = vi.fn(async () => {
  deletionEvents.push('row-delete');
  return transactionDeletedRows;
});
const transactionDeleteWhere = vi.fn(() => ({
  returning: transactionDeleteReturning,
}));
const transactionDelete = vi.fn(() => ({ where: transactionDeleteWhere }));
const transaction = {
  insert: transactionInsert,
  select: transactionSelect,
  update: transactionUpdate,
  delete: transactionDelete,
};
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

const minioService = {
  delete: vi.fn(),
  probeObjectExists: vi.fn(),
};
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
  releaseObject: vi.fn(async () => {
    uploadEvents.push('obligation-release');
  }),
  lockObjectProducer: vi.fn(async () => true),
  clearObjectInTransaction: vi.fn(async () => {
    uploadEvents.push('obligation-clear');
  }),
};
const lte = vi.fn((_column: unknown, value: unknown) => value);
const eq = vi.fn((_column: unknown, value: unknown) => value);
const selectWhere = vi.fn(async () => selectedRows);
const selectFrom = vi.fn(() => ({ where: selectWhere }));
const select = vi.fn(() => ({ from: selectFrom }));
const deleteWhere = vi.fn(async () => undefined);
const deleteFrom = vi.fn(() => ({ where: deleteWhere }));
const updateReturning = vi.fn(async () => restoredRows);
const updateWhere = vi.fn(() => ({ returning: updateReturning }));
const updateSet = vi.fn((values: Record<string, unknown>) => {
  if (values.purgeStartedAt === null) deletionEvents.push('marker-clear');
  return { where: updateWhere };
});
const update = vi.fn(() => ({ set: updateSet }));
const inArray = vi.fn((_column: unknown, values: unknown) => values);

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
  inArray,
  isNotNull: (column: unknown) => column,
  isNull: (column: unknown) => column,
  like: vi.fn(),
  lte,
  or: (...conditions: unknown[]) => conditions,
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
    update,
    query: { files: { findFirst } },
  },
  files: {
    id: 'id',
    userId: 'userId',
    expiresAt: 'expiresAt',
    deletedAt: 'deletedAt',
    purgeStartedAt: 'purgeStartedAt',
  },
  tasks: {},
  user: {
    id: 'userId',
    deletionStartedAt: 'deletionStartedAt',
  },
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
  purgeStartedAt: null,
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

const PURGE_CLAIMED_AT = new Date('2026-07-31T00:00:00.000Z');

function purgeClaim(file: File = userFile()) {
  return {
    id: file.id,
    storageKey: file.storageKey,
    purgeStartedAt: PURGE_CLAIMED_AT,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
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
    expect(cleanupObligationService.releaseObject).toHaveBeenCalledWith(fileId);
    expect(cleanupObligationService.clear).not.toHaveBeenCalled();
  });

  it('deletes object intent in the file transaction after inserting the row', async () => {
    const minioService = {
      upload: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn(),
    };
    cleanupObligationService.clearObjectInTransaction.mockImplementationOnce(
      async () => {
        expect(uploadEvents).toContain('transaction-insert');
        uploadEvents.push('obligation-clear');
      }
    );
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
    expect(
      cleanupObligationService.clearObjectInTransaction
    ).toHaveBeenCalledWith(transaction, file.id);
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
    expect(cleanupObligationService.releaseObject).toHaveBeenCalledWith(
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
    expect(cleanupObligationService.releaseObject).toHaveBeenCalledWith(
      insertedFile?.id
    );
  });

  it('does not insert a file after cleanup claimed an expired producer', async () => {
    cleanupObligationService.lockObjectProducer.mockResolvedValueOnce(false);
    const minioService = {
      upload: vi.fn().mockResolvedValue(undefined),
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
        { filename: 'late.png', mimeType: 'image/png', size: 128 },
        null
      )
    ).rejects.toThrow('Object production was claimed for cleanup');

    expect(transactionInsert).not.toHaveBeenCalled();
    expect(
      cleanupObligationService.clearObjectInTransaction
    ).not.toHaveBeenCalled();
    expect(cleanupObligationService.releaseObject).toHaveBeenCalledWith(
      expect.any(String)
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
    expect(cleanupObligationService.releaseObject).toHaveBeenCalledWith(
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
    expect(cleanupObligationService.releaseObject).toHaveBeenCalledWith(
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
    expect(cleanupObligationService.releaseObject).toHaveBeenCalledWith(fileId);
  });

  it('keeps the original error when releasing the object obligation fails', async () => {
    const databaseError = new Error('database unavailable');
    returning.mockRejectedValueOnce(databaseError);
    cleanupObligationService.releaseObject.mockRejectedValueOnce(
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

  it('rolls back file creation when deleting its transactional intent fails', async () => {
    const databaseError = new Error('database unavailable');
    cleanupObligationService.clearObjectInTransaction.mockRejectedValueOnce(
      databaseError
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
    await expect(
      service.upload(
        Buffer.from('small-buffer'),
        { filename: 'private-name.png', mimeType: 'image/png', size: 128 },
        { id: 'user-1', plan: 'free', role: 'user' }
      )
    ).rejects.toBe(databaseError);

    expect(transactionInsert).toHaveBeenCalledTimes(1);
    expect(cleanupObligationService.releaseObject).toHaveBeenCalledWith(
      insertedFile?.id
    );
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

describe('FilesService restore and permanent deletion races', () => {
  beforeEach(() => {
    selectedFile = null;
    selectedRows = [];
    lockedRows = [];
    restoredRows = [];
    transactionUpdatedRows = [];
    transactionDeletedRows = [];
    deletionEvents.length = 0;
    vi.clearAllMocks();
    transactionLock.mockImplementation(async () => lockedRows);
    transactionDeleteReturning.mockImplementation(async () => {
      deletionEvents.push('row-delete');
      return transactionDeletedRows;
    });
    updateReturning.mockImplementation(async () => restoredRows);
    withProducerTransaction.mockImplementation(async operation => {
      deletionEvents.push('transaction-start');
      const result = await operation(transaction);
      deletionEvents.push('transaction-commit');
      return result;
    });
    minioService.delete.mockImplementation(async () => {
      deletionEvents.push('object-delete');
    });
    minioService.probeObjectExists.mockResolvedValue(true);
  });

  it('restores a file only when the owned trashed row is still present', async () => {
    selectedFile = userFile();
    restoredRows = [{ id: 'file-1' }];
    const service = new FilesService(
      minioService as any,
      cleanupQueue as any,
      cleanupObligationService as any
    );

    await service.restore('file-1', 'user-1');

    expect(updateWhere).toHaveBeenCalledWith([
      'file-1',
      'user-1',
      'deletedAt',
      'purgeStartedAt',
    ]);
    expect(updateReturning).toHaveBeenCalledWith({ id: 'id' });
  });

  it('reports a missing file when cleanup commits before restore', async () => {
    selectedFile = userFile();
    restoredRows = [];
    const service = new FilesService(
      minioService as any,
      cleanupQueue as any,
      cleanupObligationService as any
    );

    await expect(service.restore('file-1', 'user-1')).rejects.toThrow(
      'File not found'
    );
  });

  it('reports only rows actually restored by a batch update', async () => {
    selectedRows = [userFile(), userFile({ id: 'file-2' })];
    restoredRows = [{ id: 'file-1' }];
    const service = new FilesService(
      minioService as any,
      cleanupQueue as any,
      cleanupObligationService as any
    );
    const log = vi
      .spyOn((service as any).logger, 'log')
      .mockImplementation(() => undefined);

    await service.batchRestore(['file-1', 'file-2'], 'user-1');

    expect(updateWhere).toHaveBeenCalledWith([
      ['file-1', 'file-2'],
      'user-1',
      'deletedAt',
      'purgeStartedAt',
    ]);
    expect(log).toHaveBeenCalledWith('Batch restored 1 files');
  });

  it('locks and rechecks eligibility before a user permanent delete', async () => {
    selectedFile = userFile();
    lockedRows = [userFile()];
    transactionUpdatedRows = [purgeClaim()];
    transactionDeletedRows = [{ id: 'file-1' }];
    const service = new FilesService(
      minioService as any,
      cleanupQueue as any,
      cleanupObligationService as any
    );

    await service.permanentDelete('file-1', 'user-1');

    expect(transactionSelectWhere).toHaveBeenCalledWith([
      'file-1',
      'user-1',
      'deletedAt',
    ]);
    expect(transactionLock).toHaveBeenCalledWith('update');
    expect(transactionDeleteWhere).toHaveBeenCalledWith([
      'file-1',
      PURGE_CLAIMED_AT,
    ]);
    expect(eq).toHaveBeenCalledWith('purgeStartedAt', PURGE_CLAIMED_AT);
    expect(deletionEvents).toEqual([
      'transaction-start',
      'marker-set',
      'transaction-commit',
      'object-delete',
      'transaction-start',
      'row-delete',
      'transaction-commit',
    ]);
  });

  it('blocks restore with the committed marker while object deletion is in flight', async () => {
    const deleteStarted = deferred();
    const finishDelete = deferred();
    lockedRows = [userFile()];
    transactionUpdatedRows = [purgeClaim()];
    transactionDeletedRows = [{ id: 'file-1' }];
    minioService.delete.mockImplementationOnce(async () => {
      deletionEvents.push('object-delete');
      deleteStarted.resolve();
      await finishDelete.promise;
    });
    updateReturning.mockImplementationOnce(async () => []);
    const service = new FilesService(
      minioService as any,
      cleanupQueue as any,
      cleanupObligationService as any
    );

    const deletion = service.permanentDelete('file-1', 'user-1');
    await deleteStarted.promise;

    expect(deletionEvents).toEqual([
      'transaction-start',
      'marker-set',
      'transaction-commit',
      'object-delete',
    ]);
    await expect(service.restore('file-1', 'user-1')).rejects.toThrow(
      'File not found'
    );
    expect(transactionDelete).not.toHaveBeenCalled();

    finishDelete.resolve();
    await expect(deletion).resolves.toBeUndefined();
  });

  it('does not duplicate object I/O while another purge lease is fresh', async () => {
    lockedRows = [userFile({ purgeStartedAt: PURGE_CLAIMED_AT })];
    transactionUpdatedRows = [];
    const service = new FilesService(
      minioService as any,
      cleanupQueue as any,
      cleanupObligationService as any
    );

    await expect(service.permanentDelete('file-1', 'user-1')).rejects.toThrow(
      'File deletion is in progress'
    );

    expect(minioService.delete).not.toHaveBeenCalled();
    expect(transactionDelete).not.toHaveBeenCalled();
    expect(withProducerTransaction).toHaveBeenCalledTimes(1);
  });

  it('rejects a concurrent delete until the known failure clears its marker', async () => {
    const deleteStarted = deferred();
    const failDelete = deferred();
    const storageError = new Error('storage unavailable');
    lockedRows = [userFile()];
    transactionUpdateReturning
      .mockResolvedValueOnce([purgeClaim()])
      .mockResolvedValueOnce([]);
    minioService.delete.mockImplementationOnce(async () => {
      deleteStarted.resolve();
      await failDelete.promise;
      throw storageError;
    });
    minioService.probeObjectExists.mockResolvedValueOnce(true);
    const service = new FilesService(
      minioService as any,
      cleanupQueue as any,
      cleanupObligationService as any
    );

    const firstDelete = service.permanentDelete('file-1', 'user-1');
    await deleteStarted.promise;

    const concurrentResult = await service
      .permanentDelete('file-1', 'user-1')
      .then(
        () => null,
        (error: unknown) => error
      );
    failDelete.resolve();
    await expect(firstDelete).rejects.toBe(storageError);

    expect(String(concurrentResult)).toContain('File deletion is in progress');
    expect(updateSet).toHaveBeenCalledWith({ purgeStartedAt: null });
    expect(minioService.delete).toHaveBeenCalledTimes(1);
  });

  it('clears the purge marker and remains restorable when storage still has the object', async () => {
    lockedRows = [userFile()];
    transactionUpdatedRows = [purgeClaim()];
    minioService.delete.mockRejectedValueOnce(new Error('storage unavailable'));
    minioService.probeObjectExists.mockResolvedValueOnce(true);
    const service = new FilesService(
      minioService as any,
      cleanupQueue as any,
      cleanupObligationService as any
    );

    await expect(service.permanentDelete('file-1', 'user-1')).rejects.toThrow(
      'storage unavailable'
    );

    expect(transactionDelete).not.toHaveBeenCalled();
    expect(transactionDeleteReturning).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith({ purgeStartedAt: null });

    restoredRows = [{ id: 'file-1' }];
    await expect(service.restore('file-1', 'user-1')).resolves.toBeUndefined();
  });

  it('finishes the row purge when DeleteObject failed but the object is absent', async () => {
    lockedRows = [userFile()];
    transactionUpdatedRows = [purgeClaim()];
    transactionDeletedRows = [{ id: 'file-1' }];
    minioService.delete.mockRejectedValueOnce(new Error('response lost'));
    minioService.probeObjectExists.mockResolvedValueOnce(false);
    const service = new FilesService(
      minioService as any,
      cleanupQueue as any,
      cleanupObligationService as any
    );

    await expect(
      service.permanentDelete('file-1', 'user-1')
    ).resolves.toBeUndefined();

    expect(updateSet).not.toHaveBeenCalledWith({ purgeStartedAt: null });
    expect(transactionDeleteReturning).toHaveBeenCalledTimes(1);
  });

  it('keeps the purge marker when both delete and probe outcomes are unknown', async () => {
    const deleteError = new Error('delete response lost');
    lockedRows = [userFile()];
    transactionUpdatedRows = [purgeClaim()];
    minioService.delete.mockRejectedValueOnce(deleteError);
    minioService.probeObjectExists.mockRejectedValueOnce(
      new Error('probe unavailable')
    );
    const service = new FilesService(
      minioService as any,
      cleanupQueue as any,
      cleanupObligationService as any
    );

    await expect(service.permanentDelete('file-1', 'user-1')).rejects.toBe(
      deleteError
    );

    expect(updateSet).not.toHaveBeenCalledWith({ purgeStartedAt: null });
    expect(transactionDelete).not.toHaveBeenCalled();
  });

  it('keeps the marker after final database failure and converges on retry', async () => {
    const databaseError = new Error('database commit failed');
    lockedRows = [userFile()];
    transactionUpdatedRows = [purgeClaim()];
    transactionDeleteReturning.mockRejectedValueOnce(databaseError);
    const service = new FilesService(
      minioService as any,
      cleanupQueue as any,
      cleanupObligationService as any
    );

    await expect(service.permanentDelete('file-1', 'user-1')).rejects.toBe(
      databaseError
    );
    expect(updateSet).not.toHaveBeenCalledWith({ purgeStartedAt: null });

    lockedRows = [userFile({ purgeStartedAt: PURGE_CLAIMED_AT })];
    transactionUpdatedRows = [purgeClaim()];
    transactionDeletedRows = [{ id: 'file-1' }];
    await expect(
      service.permanentDelete('file-1', 'user-1')
    ).resolves.toBeUndefined();
    expect(minioService.delete).toHaveBeenCalledTimes(2);
  });

  it('rechecks every row for batch delete and empty trash', async () => {
    selectedRows = [userFile(), userFile({ id: 'file-2' })];
    transactionLock
      .mockResolvedValueOnce([userFile()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([userFile({ id: 'file-3' })]);
    transactionUpdateReturning
      .mockResolvedValueOnce([purgeClaim()])
      .mockResolvedValueOnce([purgeClaim(userFile({ id: 'file-3' }))]);
    transactionDeleteReturning
      .mockResolvedValueOnce([{ id: 'file-1' }])
      .mockResolvedValueOnce([{ id: 'file-3' }]);
    const service = new FilesService(
      minioService as any,
      cleanupQueue as any,
      cleanupObligationService as any
    );

    await service.batchPermanentDelete(['file-1', 'file-2'], 'user-1');
    selectedRows = [userFile({ id: 'file-3' })];
    await service.emptyTrash('user-1');

    expect(withProducerTransaction).toHaveBeenCalledTimes(5);
    expect(transactionLock).toHaveBeenCalledTimes(3);
    expect(minioService.delete).toHaveBeenCalledTimes(2);
  });

  it('finishes safe batch items before reporting an incomplete deletion', async () => {
    const inProgress = userFile();
    const deletable = userFile({
      id: 'file-2',
      storageKey: 'user-1/file-2/report.pdf',
    });
    selectedRows = [inProgress, deletable];
    transactionLock
      .mockResolvedValueOnce([inProgress])
      .mockResolvedValueOnce([deletable]);
    transactionUpdateReturning
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([purgeClaim(deletable)]);
    transactionDeleteReturning.mockResolvedValueOnce([{ id: 'file-2' }]);
    const service = new FilesService(
      minioService as any,
      cleanupQueue as any,
      cleanupObligationService as any
    );

    await expect(
      service.batchPermanentDelete(['file-1', 'file-2'], 'user-1')
    ).rejects.toThrow('File deletion is incomplete');

    expect(minioService.delete).toHaveBeenCalledWith(
      'user-1/file-2/report.pdf'
    );
    expect(transactionDeleteReturning).toHaveBeenCalledTimes(1);
  });

  it('finishes safe trash items before reporting an incomplete empty', async () => {
    const inProgress = userFile();
    const deletable = userFile({
      id: 'file-2',
      storageKey: 'user-1/file-2/report.pdf',
    });
    selectedRows = [inProgress, deletable];
    transactionLock
      .mockResolvedValueOnce([inProgress])
      .mockResolvedValueOnce([deletable]);
    transactionUpdateReturning
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([purgeClaim(deletable)]);
    transactionDeleteReturning.mockResolvedValueOnce([{ id: 'file-2' }]);
    const service = new FilesService(
      minioService as any,
      cleanupQueue as any,
      cleanupObligationService as any
    );

    await expect(service.emptyTrash('user-1')).rejects.toThrow(
      'File deletion is incomplete'
    );

    expect(minioService.delete).toHaveBeenCalledWith(
      'user-1/file-2/report.pdf'
    );
    expect(transactionDeleteReturning).toHaveBeenCalledTimes(1);
  });

  it('skips cleanup when restore committed before the row-lock recheck', async () => {
    const cutoff = new Date('2026-07-01T00:00:00.000Z');
    selectedRows = [userFile({ deletedAt: cutoff })];
    restoredRows = [{ id: 'file-1' }];
    lockedRows = [];
    const service = new FilesService(
      minioService as any,
      cleanupQueue as any,
      cleanupObligationService as any
    );

    await service.restore('file-1', 'user-1');
    const result = await service.cleanupTrashed(
      new Date('2026-07-31T00:00:00.000Z')
    );

    expect(updateReturning).toHaveBeenCalledWith({ id: 'id' });
    expect(transactionLock).toHaveBeenCalledWith('update');
    expect(minioService.delete).not.toHaveBeenCalled();
    expect(result).toEqual({
      scanned: 1,
      deleted: 0,
      failed: 0,
      deletedFileIds: [],
      failedFileIds: [],
    });
  });
});

describe('FilesService retention cleanup', () => {
  beforeEach(() => {
    selectedRows = [];
    lockedRows = [];
    transactionUpdatedRows = [];
    transactionDeletedRows = [];
    vi.clearAllMocks();
    minioService.delete.mockResolvedValue(undefined);
    minioService.probeObjectExists.mockResolvedValue(true);
  });

  it('deletes anonymous files that expire exactly at the cleanup boundary', async () => {
    const now = new Date('2026-07-13T00:00:00.000Z');
    selectedRows = [anonymousFile({ expiresAt: now })];
    lockedRows = [anonymousFile({ expiresAt: now })];
    transactionUpdatedRows = [purgeClaim(anonymousFile({ expiresAt: now }))];
    transactionDeletedRows = [{ id: 'file-1' }];
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
    expect(transactionLock).toHaveBeenCalledWith('update');
    expect(transactionDeleteWhere).toHaveBeenCalledWith([
      'file-1',
      PURGE_CLAIMED_AT,
    ]);
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
    lockedRows = [userFile({ deletedAt: cutoff })];
    transactionUpdatedRows = [purgeClaim(userFile({ deletedAt: cutoff }))];
    transactionDeletedRows = [{ id: 'file-1' }];
    const service = new FilesService(minioService as any, cleanupQueue as any);

    const result = await service.cleanupTrashed(now);

    expect(lte).toHaveBeenCalledWith('deletedAt', cutoff);
    expect(selectWhere).toHaveBeenCalledWith([
      'deletedAt',
      [cutoff, 'purgeStartedAt'],
    ]);
    expect(transactionLock).toHaveBeenCalledWith('update');
    expect(transactionDeleteWhere).toHaveBeenCalledWith([
      'file-1',
      PURGE_CLAIMED_AT,
    ]);
    expect(result).toEqual({
      scanned: 1,
      deleted: 1,
      failed: 0,
      deletedFileIds: ['file-1'],
      failedFileIds: [],
    });
  });

  it('retries a marked trash purge before the retention boundary', async () => {
    const now = new Date('2026-07-31T00:00:00.000Z');
    const cutoff = new Date('2026-07-01T00:00:00.000Z');
    const recentTrash = userFile({
      deletedAt: new Date('2026-07-30T00:00:00.000Z'),
      purgeStartedAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    selectedRows = [recentTrash];
    lockedRows = [recentTrash];
    transactionUpdatedRows = [purgeClaim(recentTrash)];
    transactionDeletedRows = [{ id: 'file-1' }];
    const service = new FilesService(minioService as any, cleanupQueue as any);

    const result = await service.cleanupTrashed(now);

    expect(selectWhere).toHaveBeenCalledWith([
      'deletedAt',
      [cutoff, 'purgeStartedAt'],
    ]);
    expect(result.deletedFileIds).toEqual(['file-1']);
  });

  it('keeps the database row when object deletion fails', async () => {
    selectedRows = [anonymousFile()];
    lockedRows = [anonymousFile()];
    transactionUpdatedRows = [purgeClaim(anonymousFile())];
    minioService.delete.mockRejectedValueOnce(new Error('storage unavailable'));
    minioService.probeObjectExists.mockResolvedValueOnce(true);
    const service = new FilesService(minioService as any, cleanupQueue as any);
    vi.spyOn((service as any).logger, 'error').mockImplementation(() => {});

    const result = await service.cleanupExpired(
      new Date('2026-07-13T00:00:00.000Z')
    );

    expect(transactionDelete).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith({ purgeStartedAt: null });
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
    lockedRows = [anonymousFile()];
    transactionUpdatedRows = [purgeClaim(anonymousFile())];
    transactionDeletedRows = [{ id: 'file-1' }];
    const service = new FilesService(minioService as any, cleanupQueue as any);

    const result = await service.cleanupExpired(
      new Date('2026-07-13T00:00:00.000Z')
    );

    expect(minioService.delete).toHaveBeenCalledTimes(1);
    expect(transactionDeleteWhere).toHaveBeenCalledWith([
      'file-1',
      PURGE_CLAIMED_AT,
    ]);
    expect(result.deletedFileIds).toEqual(['file-1']);
    expect(result.failedFileIds).toEqual([]);
  });
});
