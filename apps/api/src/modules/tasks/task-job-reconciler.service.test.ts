import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { TaskJobReconciler } from './task-job-reconciler.service';

const TASK_ID = '00000000-0000-4000-8000-000000000001';
const identity = {
  resourceId: TASK_ID,
  queueName: 'pdf-queue',
  jobId: TASK_ID,
} as const;

function queue(name: string, events: string[]) {
  const addedJob = {
    id: TASK_ID,
    getState: vi.fn().mockResolvedValue('delayed'),
    remove: vi.fn(async () => {
      events.push('job-remove');
    }),
  };
  return {
    name,
    addedJob,
    getJob: vi.fn(async () => {
      events.push('job-get');
      return undefined;
    }),
    add: vi.fn(async () => {
      events.push('job-add');
      return addedJob;
    }),
  };
}

function activeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    type: 'pdf_merge',
    status: 'pending',
    userId: 'user-1',
    ownerId: 'user-1',
    deletionStartedAt: null,
    ...overrides,
  };
}

function createReconciler(states: Array<Record<string, unknown> | null>) {
  const events: string[] = [];
  const imageQueue = queue('image-queue', events);
  const pdfQueue = queue('pdf-queue', events);
  const fontQueue = queue('font-queue', events);
  const cleanupObligations = {
    clear: vi.fn(async () => {
      events.push('obligation-clear');
    }),
  };
  const stateRepository = {
    markProcessingFailed: vi.fn(async () => {
      events.push('task-failed');
    }),
  };
  const reconciler = new TaskJobReconciler(
    imageQueue as any,
    pdfQueue as any,
    fontQueue as any,
    cleanupObligations as any,
    stateRepository as any
  );
  vi.spyOn(reconciler as any, 'getTaskState').mockImplementation(async () => {
    events.push('task-state');
    return states.shift() ?? null;
  });

  return {
    reconciler,
    cleanupObligations,
    events,
    imageQueue,
    pdfQueue,
    fontQueue,
    stateRepository,
  };
}

describe('TaskJobReconciler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ensures a missing deterministic job for an active task before clearing the outbox', async () => {
    const { reconciler, pdfQueue, cleanupObligations, events } =
      createReconciler([activeTask(), activeTask()]);

    await reconciler.reconcile(identity);

    expect(pdfQueue.add).toHaveBeenCalledWith(
      'pdf_merge',
      { taskId: TASK_ID },
      { jobId: TASK_ID, delay: 1000 }
    );
    expect(cleanupObligations.clear).toHaveBeenCalledWith('task-job', TASK_ID);
    expect(events).toEqual([
      'task-state',
      'job-get',
      'job-add',
      'task-state',
      'obligation-clear',
    ]);
  });

  it('treats an anonymous task as active and ensures its job', async () => {
    const anonymous = activeTask({ userId: null, ownerId: null });
    const { reconciler, pdfQueue } = createReconciler([anonymous, anonymous]);

    await reconciler.reconcile(identity);

    expect(pdfQueue.add).toHaveBeenCalledTimes(1);
  });

  it('keeps an existing deterministic job and clears the outbox', async () => {
    const { reconciler, pdfQueue, cleanupObligations } = createReconciler([
      activeTask(),
      activeTask(),
    ]);
    const existingJob = {
      id: TASK_ID,
      getState: vi.fn().mockResolvedValue('waiting'),
      remove: vi.fn(),
    };
    pdfQueue.getJob
      .mockResolvedValueOnce(existingJob as any)
      .mockResolvedValueOnce(existingJob as any);

    await reconciler.reconcile(identity);

    expect(pdfQueue.add).not.toHaveBeenCalled();
    expect(existingJob.remove).not.toHaveBeenCalled();
    expect(cleanupObligations.clear).toHaveBeenCalledWith('task-job', TASK_ID);
  });

  it('removes an existing job when account deletion starts after lookup', async () => {
    const { reconciler, pdfQueue, cleanupObligations } = createReconciler([
      activeTask(),
      activeTask({
        deletionStartedAt: new Date('2026-07-15T00:00:00.000Z'),
      }),
    ]);
    const existingJob = {
      id: TASK_ID,
      getState: vi.fn().mockResolvedValue('waiting'),
      remove: vi.fn(),
    };
    pdfQueue.getJob
      .mockResolvedValueOnce(existingJob as any)
      .mockResolvedValueOnce(existingJob as any);

    await reconciler.reconcile(identity);

    expect(existingJob.remove).toHaveBeenCalledTimes(1);
    expect(cleanupObligations.clear).toHaveBeenCalledWith('task-job', TASK_ID);
  });

  it('does not recreate a completed task whose retained job disappeared', async () => {
    const completedTask = activeTask({ status: 'completed' });
    const { reconciler, pdfQueue, cleanupObligations } = createReconciler([
      completedTask,
    ]);

    await reconciler.reconcile(identity);

    expect(pdfQueue.add).not.toHaveBeenCalled();
    expect(cleanupObligations.clear).toHaveBeenCalledWith('task-job', TASK_ID);
  });

  it('does not recreate a processing task when its job is absent', async () => {
    const processingTask = activeTask({ status: 'processing' });
    const { reconciler, pdfQueue, stateRepository, cleanupObligations } =
      createReconciler([processingTask, processingTask]);

    await reconciler.reconcile(identity);

    expect(pdfQueue.add).not.toHaveBeenCalled();
    expect(stateRepository.markProcessingFailed).toHaveBeenCalledWith(TASK_ID);
    expect(cleanupObligations.clear).toHaveBeenCalledWith('task-job', TASK_ID);
  });

  it.each(['failed', 'completed', 'unknown'])(
    'requeues a pending task whose retained job is %s',
    async retainedState => {
      const { reconciler, pdfQueue, cleanupObligations } = createReconciler([
        activeTask(),
        activeTask(),
      ]);
      const retainedJob = {
        id: TASK_ID,
        getState: vi.fn().mockResolvedValue(retainedState),
        remove: vi.fn(),
      };
      pdfQueue.getJob.mockResolvedValueOnce(retainedJob as any);

      await reconciler.reconcile(identity);

      expect(retainedJob.getState).toHaveBeenCalledTimes(1);
      expect(retainedJob.remove).toHaveBeenCalledTimes(1);
      expect(pdfQueue.add).toHaveBeenCalledWith(
        'pdf_merge',
        { taskId: TASK_ID },
        { jobId: TASK_ID, delay: 1000 }
      );
      expect(cleanupObligations.clear).toHaveBeenCalledWith(
        'task-job',
        TASK_ID
      );
    }
  );

  it.each(['completed', 'failed', 'unknown'])(
    'marks processing failed and removes a retained %s job',
    async retainedState => {
      const processingTask = activeTask({ status: 'processing' });
      const { reconciler, pdfQueue, stateRepository, cleanupObligations } =
        createReconciler([processingTask, processingTask]);
      const terminalJob = {
        id: TASK_ID,
        getState: vi.fn().mockResolvedValue(retainedState),
        remove: vi.fn(),
      };
      pdfQueue.getJob.mockResolvedValueOnce(terminalJob as any);

      await reconciler.reconcile(identity);

      expect(terminalJob.remove).toHaveBeenCalledTimes(1);
      expect(stateRepository.markProcessingFailed).toHaveBeenCalledWith(
        TASK_ID
      );
      expect(cleanupObligations.clear).toHaveBeenCalledWith(
        'task-job',
        TASK_ID
      );
    }
  );

  it('removes a deterministic job when the task row is missing', async () => {
    const { reconciler, pdfQueue, cleanupObligations, events } =
      createReconciler([null]);
    const queuedJob = {
      id: TASK_ID,
      remove: vi.fn(async () => events.push('job-remove')),
    };
    pdfQueue.getJob.mockImplementationOnce(async () => {
      events.push('job-get');
      return queuedJob as any;
    });

    await reconciler.reconcile(identity);

    expect(queuedJob.remove).toHaveBeenCalledTimes(1);
    expect(cleanupObligations.clear).toHaveBeenCalledWith('task-job', TASK_ID);
    expect(events).toEqual([
      'task-state',
      'job-get',
      'job-remove',
      'obligation-clear',
    ]);
  });

  it('removes a deterministic job when its owner is deleting', async () => {
    const { reconciler, pdfQueue } = createReconciler([
      activeTask({ deletionStartedAt: new Date('2026-07-15T00:00:00.000Z') }),
    ]);
    const queuedJob = { id: TASK_ID, remove: vi.fn() };
    pdfQueue.getJob.mockResolvedValueOnce(queuedJob as any);

    await reconciler.reconcile(identity);

    expect(queuedJob.remove).toHaveBeenCalledTimes(1);
    expect(pdfQueue.add).not.toHaveBeenCalled();
  });

  it('removes a newly added job when account deletion starts during queueing', async () => {
    const { reconciler, pdfQueue, cleanupObligations, events } =
      createReconciler([
        activeTask(),
        activeTask({
          deletionStartedAt: new Date('2026-07-15T00:00:00.000Z'),
        }),
      ]);
    pdfQueue.getJob
      .mockImplementationOnce(async () => {
        events.push('job-get');
        return undefined;
      })
      .mockImplementationOnce(async () => {
        events.push('job-get');
        return pdfQueue.addedJob as any;
      });

    await reconciler.reconcile(identity);

    expect(pdfQueue.addedJob.remove).toHaveBeenCalledTimes(1);
    expect(cleanupObligations.clear).toHaveBeenCalledWith('task-job', TASK_ID);
    expect(events).toEqual([
      'task-state',
      'job-get',
      'job-add',
      'task-state',
      'job-get',
      'job-remove',
      'obligation-clear',
    ]);
  });

  it('keeps the outbox when queue add has an ambiguous failure', async () => {
    const { reconciler, pdfQueue, cleanupObligations } = createReconciler([
      activeTask(),
    ]);
    pdfQueue.add.mockRejectedValueOnce(new Error('redis disconnected'));

    await expect(reconciler.reconcile(identity)).rejects.toThrow(
      'redis disconnected'
    );

    expect(cleanupObligations.clear).not.toHaveBeenCalled();
  });
});
