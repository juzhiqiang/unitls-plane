import { describe, expect, it, vi } from 'bun:test';
import type { Job } from 'bullmq';
import { CleanupProcessor } from './cleanup.processor';
import { CleanupScheduler } from './cleanup.scheduler';

function createReconciler(
  obligation: Record<string, unknown>,
  options: {
    fileExists?: boolean;
    minioDelete?: ReturnType<typeof vi.fn>;
    taskReconcile?: ReturnType<typeof vi.fn>;
  } = {}
) {
  const cleanupObligations = {
    list: vi.fn().mockResolvedValue([obligation]),
    fileExists: vi.fn().mockResolvedValue(options.fileExists ?? false),
    claimObjectCleanup: vi.fn().mockResolvedValue(true),
    clear: vi.fn().mockResolvedValue(undefined),
    defer: vi.fn().mockResolvedValue(undefined),
  };
  const minio = {
    delete: options.minioDelete ?? vi.fn().mockResolvedValue(undefined),
  };
  const taskJobReconciler = {
    reconcile:
      options.taskReconcile ?? vi.fn().mockResolvedValue({ id: 'task-job' }),
  };

  return {
    processor: new CleanupProcessor(
      { cleanupExpired: vi.fn(), cleanupTrashed: vi.fn() } as any,
      minio as any,
      cleanupObligations as any,
      taskJobReconciler as any
    ),
    cleanupObligations,
    minio,
    taskJobReconciler,
  };
}

describe('CleanupProcessor', () => {
  it('runs expired and trash cleanup once in order and returns both summaries', async () => {
    const callOrder: string[] = [];
    const expired = {
      scanned: 1,
      deleted: 1,
      failed: 0,
      deletedFileIds: ['expired-1'],
      failedFileIds: [],
    };
    const trash = {
      scanned: 2,
      deleted: 1,
      failed: 1,
      deletedFileIds: ['trash-1'],
      failedFileIds: ['trash-2'],
    };
    const cleanupExpired = vi.fn(async () => {
      callOrder.push('expired');
      return expired;
    });
    const cleanupTrashed = vi.fn(async () => {
      callOrder.push('trash');
      return trash;
    });
    const deleteObject = vi.fn();
    const processor = new CleanupProcessor(
      {
        cleanupExpired,
        cleanupTrashed,
      } as any,
      { delete: deleteObject } as any,
      {} as any,
      { reconcile: vi.fn() } as any
    );

    const result = await processor.process({
      id: 'cleanup-1',
      name: 'cleanup-expired-files',
      data: {},
    } as Job);

    expect(callOrder).toEqual(['expired', 'trash']);
    expect(cleanupExpired).toHaveBeenCalledTimes(1);
    expect(cleanupTrashed).toHaveBeenCalledTimes(1);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(result).toEqual({ expired, trash });
  });

  it('deletes only the orphan object for a persisted compensation job', async () => {
    const filesService = {
      cleanupExpired: vi.fn(),
      cleanupTrashed: vi.fn(),
    };
    const minio = { delete: vi.fn().mockResolvedValue(undefined) };
    const cleanupObligations = {
      fileExists: vi.fn().mockResolvedValue(false),
    };
    const processor = new CleanupProcessor(
      filesService as any,
      minio as any,
      cleanupObligations as any,
      { reconcile: vi.fn() } as any
    );

    const result = await processor.process({
      id: 'orphan-file-1',
      name: 'delete-orphan-object',
      data: {
        fileId: 'file-1',
        storageKey: 'user-1/file-1/private-name.png',
      },
    } as Job);

    expect(cleanupObligations.fileExists).toHaveBeenCalledWith('file-1');
    expect(minio.delete).toHaveBeenCalledWith('user-1/file-1/private-name.png');
    expect(filesService.cleanupExpired).not.toHaveBeenCalled();
    expect(filesService.cleanupTrashed).not.toHaveBeenCalled();
    expect(result).toEqual({ orphanFileId: 'file-1' });
  });

  it('does not delete a legacy orphan object when its file row exists', async () => {
    const minio = { delete: vi.fn() };
    const cleanupObligations = {
      fileExists: vi.fn().mockResolvedValue(true),
    };
    const processor = new CleanupProcessor(
      { cleanupExpired: vi.fn(), cleanupTrashed: vi.fn() } as any,
      minio as any,
      cleanupObligations as any,
      { reconcile: vi.fn() } as any
    );

    await processor.process({
      id: 'orphan-file-1',
      name: 'delete-orphan-object',
      data: {
        fileId: 'file-1',
        storageKey: 'user-1/file-1/private-name.png',
      },
    } as Job);

    expect(cleanupObligations.fileExists).toHaveBeenCalledWith('file-1');
    expect(minio.delete).not.toHaveBeenCalled();
  });

  it('does not leak an orphan storage key in worker failure logs', () => {
    const processor = new CleanupProcessor(
      {} as any,
      {} as any,
      {} as any,
      { reconcile: vi.fn() } as any
    );
    const logError = vi
      .spyOn((processor as any).logger, 'error')
      .mockImplementation(() => undefined);
    const storageKey = 'user-1/file-1/private-name.png';

    processor.onFailed(
      { id: 'orphan-file-1' } as Job,
      new Error(`could not delete ${storageKey}`)
    );

    expect(logError).toHaveBeenCalledWith('Job orphan-file-1 failed');
    expect(JSON.stringify(logError.mock.calls)).not.toContain(storageKey);
  });

  it('does not reconcile an in-flight intent that is still under lease', async () => {
    const obligation = {
      id: 'obligation-in-flight',
      kind: 'object',
      resourceId: '00000000-0000-4000-8000-000000000000',
      storageKey: 'user-1/file-0/private.png',
      queueName: null,
      jobId: null,
      reconcileAfter: new Date('2026-07-15T01:00:00.000Z'),
      createdAt: new Date('2026-07-15T00:00:00.000Z'),
    };
    const { processor, cleanupObligations, minio, taskJobReconciler } =
      createReconciler(obligation);
    cleanupObligations.list.mockResolvedValueOnce([]);

    const result = await processor.process({
      id: 'reconcile-in-flight',
      name: 'reconcile-cleanup-obligations',
      data: {},
    } as Job);

    expect(cleanupObligations.fileExists).not.toHaveBeenCalled();
    expect(minio.delete).not.toHaveBeenCalled();
    expect(taskJobReconciler.reconcile).not.toHaveBeenCalled();
    expect(cleanupObligations.clear).not.toHaveBeenCalled();
    expect(result).toEqual({
      scanned: 0,
      cleared: 0,
      failed: 0,
      clearedResourceIds: [],
      failedResourceIds: [],
    });
  });

  it('keeps valid file objects and clears only their stale obligation', async () => {
    const obligation = {
      id: 'obligation-1',
      kind: 'object',
      resourceId: '00000000-0000-4000-8000-000000000001',
      storageKey: 'user-1/file-1/private.png',
      queueName: null,
      jobId: null,
      createdAt: new Date('2026-07-15T00:00:00.000Z'),
    };
    const { processor, cleanupObligations, minio } = createReconciler(
      obligation,
      { fileExists: true }
    );

    const result = await processor.process({
      id: 'reconcile-1',
      name: 'reconcile-cleanup-obligations',
      data: {},
    } as Job);

    expect(cleanupObligations.fileExists).toHaveBeenCalledWith(
      obligation.resourceId
    );
    expect(minio.delete).not.toHaveBeenCalled();
    expect(cleanupObligations.clear).toHaveBeenCalledWith(
      'object',
      obligation.resourceId
    );
    expect(result).toEqual({
      scanned: 1,
      cleared: 1,
      failed: 0,
      clearedResourceIds: [obligation.resourceId],
      failedResourceIds: [],
    });
  });

  it('deletes orphan objects before clearing their obligation', async () => {
    const events: string[] = [];
    const obligation = {
      id: 'obligation-2',
      kind: 'object',
      resourceId: '00000000-0000-4000-8000-000000000002',
      storageKey: 'user-1/file-2/private.png',
      queueName: null,
      jobId: null,
      createdAt: new Date('2026-07-15T00:00:00.000Z'),
    };
    const minioDelete = vi.fn(async () => {
      events.push('object-delete');
    });
    const { processor, cleanupObligations } = createReconciler(obligation, {
      minioDelete,
    });
    cleanupObligations.clear.mockImplementationOnce(async () => {
      events.push('obligation-clear');
    });

    await processor.process({
      id: 'reconcile-2',
      name: 'reconcile-cleanup-obligations',
      data: {},
    } as Job);

    expect(minioDelete).toHaveBeenCalledWith(obligation.storageKey);
    expect(events).toEqual(['object-delete', 'obligation-clear']);
  });

  it('does not clean an object when the producer transaction won the row lock', async () => {
    const obligation = {
      id: 'obligation-producer-locked',
      kind: 'object',
      state: 'producing',
      resourceId: '00000000-0000-4000-8000-000000000012',
      storageKey: 'user-1/file-12/private.png',
      queueName: null,
      jobId: null,
      reconcileAfter: new Date('2026-07-15T00:00:00.000Z'),
      createdAt: new Date('2026-07-14T23:00:00.000Z'),
    };
    const { processor, cleanupObligations, minio } =
      createReconciler(obligation);
    cleanupObligations.claimObjectCleanup.mockResolvedValueOnce(false);

    await processor.process({
      id: 'reconcile-producer-locked',
      name: 'reconcile-cleanup-obligations',
      data: {},
    } as Job);

    expect(cleanupObligations.claimObjectCleanup).toHaveBeenCalledWith(
      obligation.resourceId
    );
    expect(cleanupObligations.fileExists).not.toHaveBeenCalled();
    expect(minio.delete).not.toHaveBeenCalled();
    expect(cleanupObligations.clear).not.toHaveBeenCalled();
  });

  it('retries a claimed object after cleanup crashes', async () => {
    const obligation = {
      id: 'obligation-cleanup-retry',
      kind: 'object',
      state: 'cleanup',
      resourceId: '00000000-0000-4000-8000-000000000013',
      storageKey: 'user-1/file-13/private.png',
      queueName: null,
      jobId: null,
      reconcileAfter: new Date('2026-07-15T00:00:00.000Z'),
      createdAt: new Date('2026-07-14T23:00:00.000Z'),
    };
    const minioDelete = vi
      .fn()
      .mockRejectedValueOnce(new Error('worker crashed'))
      .mockResolvedValueOnce(undefined);
    const { processor, cleanupObligations } = createReconciler(obligation, {
      minioDelete,
    });
    vi.spyOn((processor as any).logger, 'error').mockImplementation(
      () => undefined
    );

    await processor.process({
      id: 'reconcile-cleanup-retry-1',
      name: 'reconcile-cleanup-obligations',
      data: {},
    } as Job);
    await processor.process({
      id: 'reconcile-cleanup-retry-2',
      name: 'reconcile-cleanup-obligations',
      data: {},
    } as Job);

    expect(cleanupObligations.claimObjectCleanup).toHaveBeenCalledTimes(2);
    expect(minioDelete).toHaveBeenCalledTimes(2);
    expect(cleanupObligations.clear).toHaveBeenCalledTimes(1);
  });

  it('delegates task job convergence to the task reconciler', async () => {
    const obligation = {
      id: 'obligation-3',
      kind: 'task-job',
      resourceId: '00000000-0000-4000-8000-000000000003',
      storageKey: null,
      queueName: 'pdf-queue',
      jobId: '00000000-0000-4000-8000-000000000003',
      createdAt: new Date('2026-07-15T00:00:00.000Z'),
    };
    const { processor, cleanupObligations, taskJobReconciler } =
      createReconciler(obligation);

    await processor.process({
      id: 'reconcile-3',
      name: 'reconcile-cleanup-obligations',
      data: {},
    } as Job);

    expect(taskJobReconciler.reconcile).toHaveBeenCalledWith({
      resourceId: obligation.resourceId,
      queueName: obligation.queueName,
      jobId: obligation.jobId,
    });
    expect(cleanupObligations.clear).not.toHaveBeenCalled();
  });

  it('keeps object obligations when storage cleanup fails without logging keys', async () => {
    const obligation = {
      id: 'obligation-5',
      kind: 'object',
      resourceId: '00000000-0000-4000-8000-000000000005',
      storageKey: 'user-1/file-5/private-name.png',
      queueName: null,
      jobId: null,
      createdAt: new Date('2026-07-15T00:00:00.000Z'),
    };
    const { processor, cleanupObligations } = createReconciler(obligation, {
      minioDelete: vi.fn().mockRejectedValue(new Error('storage unavailable')),
    });
    const logError = vi
      .spyOn((processor as any).logger, 'error')
      .mockImplementation(() => undefined);

    const result = await processor.process({
      id: 'reconcile-5',
      name: 'reconcile-cleanup-obligations',
      data: {},
    } as Job);

    expect(cleanupObligations.clear).not.toHaveBeenCalled();
    expect(cleanupObligations.defer).toHaveBeenCalledWith(
      'object',
      obligation.resourceId
    );
    expect(result).toEqual({
      scanned: 1,
      cleared: 0,
      failed: 1,
      clearedResourceIds: [],
      failedResourceIds: [obligation.resourceId],
    });
    expect(JSON.stringify(logError.mock.calls)).not.toContain(
      obligation.storageKey
    );
  });

  it('defers task obligations when desired-state convergence fails', async () => {
    const obligation = {
      id: 'obligation-6',
      kind: 'task-job',
      resourceId: '00000000-0000-4000-8000-000000000006',
      storageKey: null,
      queueName: 'pdf-queue',
      jobId: '00000000-0000-4000-8000-000000000006',
      createdAt: new Date('2026-07-15T00:00:00.000Z'),
    };
    const taskReconcile = vi
      .fn()
      .mockRejectedValue(new Error('redis unavailable'));
    const { processor, cleanupObligations } = createReconciler(obligation, {
      taskReconcile,
    });
    vi.spyOn((processor as any).logger, 'error').mockImplementation(
      () => undefined
    );

    await processor.process({
      id: 'reconcile-6',
      name: 'reconcile-cleanup-obligations',
      data: {},
    } as Job);

    expect(taskReconcile).toHaveBeenCalledWith({
      resourceId: obligation.resourceId,
      queueName: obligation.queueName,
      jobId: obligation.jobId,
    });
    expect(cleanupObligations.clear).not.toHaveBeenCalled();
    expect(cleanupObligations.defer).toHaveBeenCalledWith(
      'task-job',
      obligation.resourceId
    );
  });
});

describe('CleanupScheduler', () => {
  it('uses a stable job id for the hourly retention schedule', async () => {
    const add = vi.fn(async () => undefined);
    const scheduler = new CleanupScheduler({ add } as any);

    await scheduler.onModuleInit();

    expect(add).toHaveBeenCalledWith(
      'cleanup-expired-files',
      {},
      {
        jobId: 'hourly-file-retention',
        repeat: { pattern: '0 * * * *' },
      }
    );
  });

  it('schedules durable cleanup obligation reconciliation every minute', async () => {
    const add = vi.fn(async () => undefined);
    const scheduler = new CleanupScheduler({ add } as any);

    await scheduler.onModuleInit();

    expect(add).toHaveBeenCalledWith(
      'reconcile-cleanup-obligations',
      {},
      {
        jobId: 'minute-cleanup-obligations',
        repeat: { pattern: '* * * * *' },
      }
    );
  });
});
