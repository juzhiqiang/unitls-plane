import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
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
/** markCompleted / markRetrying 只有 update:抓住 set 的载荷,断言写进去的字段。 */
const updatedValues: Array<Record<string, unknown>> = [];
const globalUpdate = vi.fn(() => ({
  set: (values: Record<string, unknown>) => {
    updatedValues.push(values);
    return { where: () => undefined };
  },
}));
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
  db: { insert: globalInsert, update: globalUpdate },
  files: {},
  tasks: {},
  user: {},
}));
mock.module('../../common/database/active-user-transaction', () => ({
  withActiveUserTransaction,
  withProducerTransaction,
}));
const countTasksCreatedToday = vi.fn(async () => 0);
mock.module('./daily-task-quota', () => ({ countTasksCreatedToday }));
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
  countTasksCreatedToday.mockResolvedValue(0);
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
    expect(countTasksCreatedToday).not.toHaveBeenCalled();
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

  it('allows an image generation task while under the daily quota', async () => {
    const { service } = createService();
    countTasksCreatedToday.mockResolvedValue(9);

    await expect(
      service.create(
        {
          type: 'image_generate',
          inputFileIds: [],
          inputConfig: { mode: 'text_to_image', prompt: 'x' },
        },
        { id: 'user-1', plan: 'signed_in', role: 'user' } as never
      )
    ).resolves.toMatchObject({ type: 'image_generate' });
  });

  it('rejects an image generation task once the daily quota is reached', async () => {
    const { service, aiQueue } = createService();
    countTasksCreatedToday.mockResolvedValue(10);

    const error = await service
      .create(
        {
          type: 'image_generate',
          inputFileIds: [],
          inputConfig: { mode: 'text_to_image', prompt: 'x' },
        },
        { id: 'user-1', plan: 'signed_in', role: 'user' } as never
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ForbiddenException);
    if (!(error instanceof ForbiddenException)) {
      throw new Error('Expected a ForbiddenException');
    }
    expect(error.getStatus()).toBe(403);
    expect(error.getResponse()).toEqual({
      code: ErrorCodes.AI_IMAGE_DAILY_LIMIT_EXCEEDED,
      message: 'Daily image generation limit of 10 reached',
    });

    expect(transactionInsert).not.toHaveBeenCalled();
    expect(aiQueue.add).not.toHaveBeenCalled();
    expect(events).toContain('rollback');
  });
});

describe('TasksService image generation quota snapshot', () => {
  // getImageGenerateQuota 是只读快照:用全局 db 直接 count,既不进事务,也不持有 user 行锁。
  // 这里只验证 limit/used/remaining 三个数字算对了,真正的并发超额拦截仍由 create() 在事务里兜底。
  it('returns limit/used/remaining for a signed-in user under quota', async () => {
    const { service } = createService();
    countTasksCreatedToday.mockResolvedValue(3);

    const quota = await service.getImageGenerateQuota({
      id: 'user-1',
      plan: 'signed_in',
      role: 'user',
    });

    expect(quota).toEqual({ limit: 10, used: 3, remaining: 7 });
  });

  it('clamps remaining to zero once the daily quota is used up', async () => {
    const { service } = createService();
    countTasksCreatedToday.mockResolvedValue(10);

    const quota = await service.getImageGenerateQuota({
      id: 'user-1',
      plan: 'signed_in',
      role: 'user',
    });

    expect(quota).toEqual({ limit: 10, used: 10, remaining: 0 });
  });

  it('keeps remaining at zero when usage exceeds the limit', async () => {
    const { service } = createService();
    countTasksCreatedToday.mockResolvedValue(42);

    const quota = await service.getImageGenerateQuota({
      id: 'user-1',
      plan: 'signed_in',
      role: 'user',
    });

    expect(quota).toEqual({ limit: 10, used: 42, remaining: 0 });
  });

  it('reflects higher limits for higher plans', async () => {
    const { service } = createService();
    countTasksCreatedToday.mockResolvedValue(0);

    const quota = await service.getImageGenerateQuota({
      id: 'user-1',
      plan: 'pro_preview',
      role: 'user',
    });

    expect(quota).toEqual({ limit: 100, used: 0, remaining: 100 });
  });

  it('counts only image_generate tasks for the given user', async () => {
    const { service } = createService();
    countTasksCreatedToday.mockResolvedValue(5);

    await service.getImageGenerateQuota({
      id: 'user-1',
      plan: 'signed_in',
      role: 'user',
    });

    expect(countTasksCreatedToday).toHaveBeenCalledWith(
      // 第一个参数是 db(只读查询用全局 db,不进事务)
      expect.objectContaining({ insert: globalInsert }),
      'user-1',
      'image_generate'
    );
  });

  // resolveEntitlementPlan:有 userId 但 plan='free' 时回退到 signed_in(=10),
  // 只有完全匿名(无 userId)才会落到 free=0。匿名用户在控制器就被 401 拦下,
  // 服务方法不会收到无 id 的 user,所以这里只验证登录态 free 用户拿到 signed_in 额度。
  it('falls back to the signed-in limit for a logged-in free user', async () => {
    const { service } = createService();
    countTasksCreatedToday.mockResolvedValue(2);

    const quota = await service.getImageGenerateQuota({
      id: 'user-1',
      plan: 'free',
      role: 'user',
    });

    expect(quota).toEqual({ limit: 10, used: 2, remaining: 8 });
  });

  it('maps admins to the pro plan limit', async () => {
    const { service } = createService();
    countTasksCreatedToday.mockResolvedValue(0);

    const quota = await service.getImageGenerateQuota({
      id: 'admin-1',
      plan: 'signed_in',
      role: 'admin',
    });

    expect(quota).toEqual({ limit: 50, used: 0, remaining: 50 });
  });
});

describe('TasksService attempt bookkeeping', () => {
  beforeEach(() => {
    updatedValues.length = 0;
  });

  it('clears the previous attempt error when a retry finally completes', async () => {
    const { service } = createService();

    await service.markCompleted(TASK_ID, 'output-1');

    expect(updatedValues[0]).toMatchObject({
      status: 'completed',
      outputFileId: 'output-1',
      progress: 100,
      // 不清掉就会出现「任务是 done、详情里却挂着上一次 attempt 的失败原因」。
      errorCode: null,
      errorMessage: null,
    });
  });

  it('sends a task back to pending between attempts', async () => {
    const { service } = createService();

    await service.markRetrying(TASK_ID);

    const values = updatedValues[0] ?? {};
    // 不能留在 processing:退避期间 job 是 delayed,TaskJobReconciler 会把
    // 「processing 但 job 不是 active」判成失败并清掉任务。
    expect(values.status).toBe('pending');
    expect(values.progress).toBe(0);
    expect(values.errorCode).toBeNull();
    // sql`retry_count + 1` 的具体形状由 drizzle 决定(且被别的测试文件 mock 掉了),
    // 这里只锁住「载荷里确实带上了 retryCount 自增」。
    expect(Object.keys(values)).toContain('retryCount');
  });
});
