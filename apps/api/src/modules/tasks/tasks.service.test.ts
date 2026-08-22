import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorCodes } from '../../common/errors/error-codes';

let insertedTask: Record<string, unknown> | null = null;
const events: string[] = [];
const TASK_ID = '00000000-0000-4000-8000-000000000002';
vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
  TASK_ID as `${string}-${string}-${string}-${string}-${string}`
);

const returning = vi.fn(() => [
  {
    id: insertedTask?.id ?? TASK_ID,
    userId: insertedTask?.userId ?? null,
    type: insertedTask?.type,
    status: insertedTask?.status,
    inputFileIds: insertedTask?.inputFileIds,
    inputConfig: insertedTask?.inputConfig,
    outputFileId: null,
    progress: 0,
    errorCode: null,
    errorMessage: null,
    retryCount: 0,
    createdAt: new Date('2026-07-12T00:00:00.000Z'),
    completedAt: null,
  },
]);
const globalValues = vi.fn((task: Record<string, unknown>) => {
  events.push('global-insert');
  insertedTask = task;
  return { returning };
});
const transactionValues = vi.fn((task: Record<string, unknown>) => {
  events.push('transaction-insert');
  insertedTask = task;
  return { returning };
});
const globalInsert = vi.fn(() => ({ values: globalValues }));
const transactionInsert = vi.fn(() => ({ values: transactionValues }));
const transaction = { insert: transactionInsert };
const cleanupObligationService = {
  recordTaskJob: vi.fn(async () => {
    events.push('obligation-record');
  }),
  clear: vi.fn(async () => {
    events.push('obligation-clear');
  }),
  release: vi.fn(async () => {
    events.push('obligation-release');
  }),
};

const withActiveUserTransaction = vi.fn(
  async (
    _userId: string,
    operation: (tx: typeof transaction) => Promise<unknown>
  ) => {
    events.push('transaction');
    try {
      const result = await operation(transaction);
      events.push('commit');
      return result;
    } catch (error) {
      events.push('rollback');
      throw error;
    }
  }
);
const withProducerTransaction = vi.fn(
  async (operation: (tx: typeof transaction) => Promise<unknown>) => {
    events.push('transaction');
    try {
      const result = await operation(transaction);
      events.push('commit');
      return result;
    } catch (error) {
      events.push('rollback');
      throw error;
    }
  }
);

mock.module('@utils-plane/db', () => ({
  cleanupObligations: {
    kind: 'obligation-kind',
    resourceId: 'obligation-resource-id',
  },
  db: { insert: globalInsert },
  files: {},
  tasks: {},
  user: {},
}));
mock.module('../../common/database/active-user-transaction', () => ({
  withActiveUserTransaction,
  withProducerTransaction,
}));
const { TasksService } = await import('./tasks.service');

function queue(name: string) {
  const remove = vi.fn().mockResolvedValue(undefined);
  return {
    name,
    remove,
    add: vi.fn(
      async (_type: string, data: unknown, options: { jobId: string }) => {
        events.push('queue-add');
        return { id: options.jobId, data, remove };
      }
    ),
    getWaitingCount: vi.fn().mockResolvedValue(0),
    getActiveCount: vi.fn().mockResolvedValue(0),
  };
}

function createService(
  filesService = {
    getById: vi.fn().mockResolvedValue({ id: 'file-1', userId: null }),
  }
) {
  const imageQueue = queue('image-queue');
  const pdfQueue = queue('pdf-queue');
  const fontQueue = queue('font-queue');
  const aiQueue = queue('ai-queue');
  const taskJobReconciler = {
    reconcile: vi.fn(
      async (identity: {
        resourceId: string;
        queueName: string;
        jobId: string;
      }) => {
        const targetQueue =
          identity.queueName === 'image-queue'
            ? imageQueue
            : identity.queueName === 'pdf-queue'
              ? pdfQueue
              : identity.queueName === 'ai-queue'
                ? aiQueue
                : fontQueue;
        const queuedJob = await targetQueue.add(
          String(insertedTask?.type),
          { taskId: identity.resourceId },
          { jobId: identity.jobId, delay: 1000 }
        );
        await cleanupObligationService.clear('task-job', identity.resourceId);
        return queuedJob;
      }
    ),
  };

  return {
    service: new TasksService(
      imageQueue as any,
      pdfQueue as any,
      fontQueue as any,
      aiQueue as any,
      filesService as any,
      cleanupObligationService as any,
      taskJobReconciler as any
    ),
    filesService,
    imageQueue,
    pdfQueue,
    fontQueue,
    aiQueue,
    taskJobReconciler,
  };
}

beforeEach(() => {
  insertedTask = null;
  events.length = 0;
  vi.clearAllMocks();
});

describe('TasksService task creation', () => {
  it('keeps server task entitlement checks before database work', () => {
    const source = readFileSync(
      join(import.meta.dir, 'tasks.service.ts'),
      'utf8'
    );

    expect(source).toContain("canUseFeature(user, 'task.serverProcessing')");
    expect(source).toContain('assertCanCreateTask');
  });

  it('rejects anonymous server tasks before inserting or queueing', async () => {
    const { service, filesService, pdfQueue } = createService();

    await expect(
      service.create(
        { type: 'pdf_merge', inputFileIds: ['file-1'], inputConfig: {} },
        null
      )
    ).rejects.toThrow('Sign in is required for server processing tasks');

    expect(filesService.getById).not.toHaveBeenCalled();
    expect(globalInsert).not.toHaveBeenCalled();
    expect(pdfQueue.add).not.toHaveBeenCalled();
    expect(withActiveUserTransaction).not.toHaveBeenCalled();
  });

  it('rejects anonymous AI image generation before inserting or queueing', async () => {
    const { service, filesService, aiQueue } = createService();

    await expect(
      service.create(
        {
          type: 'image_generate',
          inputFileIds: [],
          inputConfig: { mode: 'text_to_image', prompt: 'x' },
        },
        null
      )
    ).rejects.toThrow('Sign in is required for server processing tasks');

    expect(filesService.getById).not.toHaveBeenCalled();
    expect(globalInsert).not.toHaveBeenCalled();
    expect(aiQueue.add).not.toHaveBeenCalled();
    expect(withActiveUserTransaction).not.toHaveBeenCalled();
  });

  it('writes anonymous task and outbox rows in one transaction before queueing', async () => {
    const { service, filesService, imageQueue } = createService();

    const task = await service.create(
      { type: 'compress', inputFileIds: ['file-1'], inputConfig: {} },
      null
    );

    expect(filesService.getById).toHaveBeenCalledWith(
      'file-1',
      null,
      transaction
    );
    expect(task.userId).toBeNull();
    expect(globalInsert).not.toHaveBeenCalled();
    expect(transactionInsert).toHaveBeenCalledTimes(1);
    expect(withProducerTransaction).toHaveBeenCalledTimes(1);
    expect(cleanupObligationService.recordTaskJob).toHaveBeenCalledWith(
      TASK_ID,
      'image-queue',
      TASK_ID,
      transaction
    );
    expect(imageQueue.add).toHaveBeenCalledWith(
      'compress',
      { taskId: TASK_ID },
      { jobId: TASK_ID, delay: 1000 }
    );
    expect(events.indexOf('commit')).toBeLessThan(events.indexOf('queue-add'));
  });

  it('rejects historical compression files above the current account limit', async () => {
    const filesService = {
      getById: vi.fn().mockResolvedValue({
        id: 'file-1',
        userId: 'user-1',
        originalSize: 51 * 1024 * 1024,
      }),
    };
    const { service, imageQueue, taskJobReconciler } =
      createService(filesService);

    const error = await service
      .create(
        { type: 'compress', inputFileIds: ['file-1'], inputConfig: {} },
        { id: 'user-1', plan: 'free', role: 'user' }
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    if (!(error instanceof BadRequestException)) {
      throw new Error('Expected a BadRequestException');
    }
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toEqual({
      code: ErrorCodes.FILE_TOO_LARGE,
      message: 'File size exceeds limit of 50MB',
    });

    expect(filesService.getById).toHaveBeenCalledWith(
      'file-1',
      'user-1',
      transaction
    );
    expect(transactionInsert).not.toHaveBeenCalled();
    expect(cleanupObligationService.recordTaskJob).not.toHaveBeenCalled();
    expect(taskJobReconciler.reconcile).not.toHaveBeenCalled();
    expect(imageQueue.add).not.toHaveBeenCalled();
  });

  it('commits file checks, task, and outbox before queueing', async () => {
    const filesService = {
      getById: vi.fn(
        async (
          fileId: string,
          userId?: string | null,
          operationTx?: unknown
        ) => {
          events.push('file-access');
          expect(fileId).toBe('file-1');
          expect(userId).toBe('user-1');
          expect(operationTx).toBe(transaction);
          return { id: fileId, userId };
        }
      ),
    };
    const { service, pdfQueue } = createService(filesService);

    const task = await service.create(
      { type: 'pdf_merge', inputFileIds: ['file-1'], inputConfig: {} },
      { id: 'user-1', plan: 'free', role: 'user' }
    );

    expect(task.userId).toBe('user-1');
    expect(globalInsert).not.toHaveBeenCalled();
    expect(transactionInsert).toHaveBeenCalledTimes(1);
    expect(cleanupObligationService.recordTaskJob).toHaveBeenCalledWith(
      TASK_ID,
      'pdf-queue',
      TASK_ID,
      transaction
    );
    expect(pdfQueue.add).toHaveBeenCalledWith(
      'pdf_merge',
      { taskId: TASK_ID },
      { jobId: TASK_ID, delay: 1000 }
    );
    expect(events).toEqual([
      'transaction',
      'file-access',
      'transaction-insert',
      'obligation-record',
      'commit',
      'queue-add',
      'obligation-clear',
    ]);
  });

  it('commits the database transaction before waiting on Redis', async () => {
    let resolveQueueAdd: ((job: { id: string }) => void) | undefined;
    let markQueueAddStarted: (() => void) | undefined;
    const queueAddStarted = new Promise<void>(resolve => {
      markQueueAddStarted = resolve;
    });
    const { service, pdfQueue } = createService();
    pdfQueue.add.mockImplementationOnce(async () => {
      events.push('queue-add');
      markQueueAddStarted?.();
      return new Promise(resolve => {
        resolveQueueAdd = resolve;
      });
    });

    const result = service.create(
      { type: 'pdf_merge', inputFileIds: ['file-1'], inputConfig: {} },
      { id: 'user-1', plan: 'free', role: 'user' }
    );
    await queueAddStarted;
    const committedBeforeRedisSettled = events.includes('commit');
    resolveQueueAdd?.({ id: TASK_ID });
    await result;

    expect(committedBeforeRedisSettled).toBeTrue();
    expect(events.indexOf('commit')).toBeLessThan(events.indexOf('queue-add'));
  });

  it('returns the committed task and keeps the outbox when queue add is ambiguous', async () => {
    const queueError = new Error('queue unavailable');
    const { service, pdfQueue } = createService();
    pdfQueue.add.mockImplementationOnce(async () => {
      events.push('queue-add');
      throw queueError;
    });

    const task = await service.create(
      { type: 'pdf_merge', inputFileIds: ['file-1'], inputConfig: {} },
      { id: 'user-1', plan: 'free', role: 'user' }
    );

    expect(task.id).toBe(TASK_ID);
    expect(transactionInsert).toHaveBeenCalledTimes(1);
    expect(events).toContain('commit');
    expect(cleanupObligationService.recordTaskJob).toHaveBeenCalledWith(
      TASK_ID,
      'pdf-queue',
      TASK_ID,
      transaction
    );
    expect(cleanupObligationService.clear).not.toHaveBeenCalled();
    expect(cleanupObligationService.release).not.toHaveBeenCalled();
  });

  it('does not touch Redis or the outbox after an ambiguous commit failure', async () => {
    const commitError = new Error('connection lost during commit');
    withActiveUserTransaction.mockImplementationOnce(
      async (_userId, operation) => {
        events.push('transaction');
        await operation(transaction);
        events.push('commit-failed');
        throw commitError;
      }
    );
    const { service, pdfQueue } = createService();

    await expect(
      service.create(
        { type: 'pdf_merge', inputFileIds: ['file-1'], inputConfig: {} },
        { id: 'user-1', plan: 'free', role: 'user' }
      )
    ).rejects.toBe(commitError);

    expect(transactionInsert).toHaveBeenCalledTimes(1);
    expect(cleanupObligationService.recordTaskJob).toHaveBeenCalledWith(
      TASK_ID,
      'pdf-queue',
      TASK_ID,
      transaction
    );
    expect(events).toContain('commit-failed');
    expect(pdfQueue.add).not.toHaveBeenCalled();
    expect(pdfQueue.remove).not.toHaveBeenCalled();
    expect(cleanupObligationService.clear).not.toHaveBeenCalled();
    expect(cleanupObligationService.release).not.toHaveBeenCalled();
  });

  it('does not access files, insert, or queue when deletion already started', async () => {
    withActiveUserTransaction.mockRejectedValueOnce(
      new Error('Account deletion is in progress')
    );
    const { service, filesService, pdfQueue } = createService();

    await expect(
      service.create(
        { type: 'pdf_merge', inputFileIds: ['file-1'], inputConfig: {} },
        { id: 'user-1', plan: 'free', role: 'user' }
      )
    ).rejects.toThrow('Account deletion is in progress');

    expect(filesService.getById).not.toHaveBeenCalled();
    expect(transactionInsert).not.toHaveBeenCalled();
    expect(pdfQueue.add).not.toHaveBeenCalled();
  });

  it('validates ordered file ids inside the active-user transaction', async () => {
    const filesService = {
      getById: vi.fn(
        async (
          fileId: string,
          userId?: string | null,
          operationTx?: unknown
        ) => {
          expect(operationTx).toBe(transaction);
          if (fileId === 'foreign-file') throw new Error('Access denied');
          return { id: fileId, userId };
        }
      ),
    };
    const { service, pdfQueue } = createService(filesService);

    await expect(
      service.create(
        {
          type: 'pdf_merge',
          inputFileIds: ['owned-file'],
          inputConfig: { order: ['owned-file', 'foreign-file'] },
        },
        { id: 'user-1', plan: 'free', role: 'user' }
      )
    ).rejects.toThrow('Access denied');

    expect(transactionInsert).not.toHaveBeenCalled();
    expect(pdfQueue.add).not.toHaveBeenCalled();
  });
});
