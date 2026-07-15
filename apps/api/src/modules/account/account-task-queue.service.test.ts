import { beforeEach, describe, expect, it, vi } from 'bun:test';
import {
  AccountTaskQueueService,
  MAX_LEGACY_SCAN_KEYS,
} from './account-task-queue.service';

function job(
  id: string,
  taskId: string,
  state: string,
  remove = vi.fn().mockResolvedValue(undefined)
) {
  return {
    id,
    data: { taskId },
    getState: vi.fn().mockResolvedValue(state),
    remove,
  };
}

function queue(name: string) {
  const jobs = new Map<string, ReturnType<typeof job>>();
  const redis = {
    scan: vi.fn().mockResolvedValue(['0', []]),
    type: vi.fn().mockResolvedValue('hash'),
    hget: vi.fn().mockResolvedValue(null),
  };
  return {
    name,
    jobs,
    redis,
    client: Promise.resolve(redis),
    toKey: (suffix: string) => `bull:${name}:${suffix}`,
    getJob: vi.fn(async (id: string) => jobs.get(id)),
  };
}

type ScanState = {
  userId: string;
  queueName: string;
  cursor: string;
  completed: boolean;
  pendingKeys: string[];
  jobIds: string[];
  version: number;
};

function scanRepository() {
  const states = new Map<string, ScanState>();
  return {
    states,
    getOrCreateDeletionQueueScan: vi.fn(
      async (userId: string, queueName: string) => {
        const key = `${userId}:${queueName}`;
        const current = states.get(key) ?? {
          userId,
          queueName,
          cursor: '0',
          completed: false,
          pendingKeys: [],
          jobIds: [],
          version: 0,
        };
        states.set(key, current);
        return current;
      }
    ),
    saveDeletionQueueScan: vi.fn(
      async (
        userId: string,
        queueName: string,
        expectedVersion: number,
        changes: Partial<ScanState>
      ) => {
        const key = `${userId}:${queueName}`;
        const current = states.get(key);
        if (!current || current.version !== expectedVersion) return null;
        const next = {
          ...current,
          ...changes,
          version: current.version + 1,
        };
        states.set(key, next);
        return next;
      }
    ),
  };
}

let imageQueue = queue('image-queue');
let pdfQueue = queue('pdf-queue');
let fontQueue = queue('font-queue');
let repository = scanRepository();

function service() {
  return new AccountTaskQueueService(
    imageQueue as any,
    pdfQueue as any,
    fontQueue as any,
    repository as any
  );
}

beforeEach(() => {
  imageQueue = queue('image-queue');
  pdfQueue = queue('pdf-queue');
  fontQueue = queue('font-queue');
  repository = scanRepository();
});

describe('AccountTaskQueueService', () => {
  it('rejects deletion without removing jobs when any deterministic job is active', async () => {
    const activeJob = job('task-1', 'task-1', 'active');
    const waitingJob = job('task-2', 'task-2', 'waiting');
    pdfQueue.jobs.set('task-1', activeJob);
    pdfQueue.jobs.set('task-2', waitingJob);

    await expect(
      service().assertNoActiveAndRemove('user-1', [
        { id: 'task-1', type: 'pdf_merge' },
        { id: 'task-2', type: 'pdf_split' },
      ])
    ).rejects.toThrow('Account has active tasks');

    expect(activeJob.remove).not.toHaveBeenCalled();
    expect(waitingJob.remove).not.toHaveBeenCalled();
    expect(pdfQueue.redis.scan).not.toHaveBeenCalled();
  });

  it('does not scan legacy keys when every deterministic job exists', async () => {
    const jobs = [
      job('task-1', 'task-1', 'waiting'),
      job('task-2', 'task-2', 'delayed'),
      job('task-3', 'task-3', 'failed'),
    ];
    for (const queuedJob of jobs) {
      pdfQueue.jobs.set(String(queuedJob.id), queuedJob);
    }

    await service().assertNoActiveAndRemove(
      'user-1',
      jobs.map(queuedJob => ({
        id: String(queuedJob.id),
        type: 'pdf_split' as const,
      }))
    );

    expect(pdfQueue.redis.scan).not.toHaveBeenCalled();
    expect(repository.getOrCreateDeletionQueueScan).not.toHaveBeenCalled();
    for (const queuedJob of jobs) {
      expect(queuedJob.remove).toHaveBeenCalledTimes(1);
    }
  });

  it('resumes a bounded legacy scan and finds every target before removal', async () => {
    const firstPageKeys = Array.from(
      { length: MAX_LEGACY_SCAN_KEYS },
      (_, index) => pdfQueue.toKey(`legacy-other-${index}`)
    );
    const targetKeys = [
      pdfQueue.toKey('legacy-target-1'),
      pdfQueue.toKey('legacy-target-2'),
    ];
    pdfQueue.redis.scan.mockImplementation(async (cursor: string) =>
      cursor === '0' ? ['7', firstPageKeys] : ['0', targetKeys]
    );
    pdfQueue.redis.hget.mockImplementation(async (key: string) => {
      if (key.endsWith('legacy-target-1')) {
        return JSON.stringify({ taskId: 'task-1' });
      }
      if (key.endsWith('legacy-target-2')) {
        return JSON.stringify({ taskId: 'task-2' });
      }
      return JSON.stringify({ taskId: `other-${key}` });
    });
    const legacyJob1 = job('legacy-target-1', 'task-1', 'waiting');
    const legacyJob2 = job('legacy-target-2', 'task-2', 'completed');
    pdfQueue.jobs.set('legacy-target-1', legacyJob1);
    pdfQueue.jobs.set('legacy-target-2', legacyJob2);
    const tasks = [
      { id: 'task-1', type: 'pdf_merge' as const },
      { id: 'task-2', type: 'pdf_split' as const },
    ];

    await expect(
      service().assertNoActiveAndRemove('user-1', tasks)
    ).rejects.toThrow('Account task scan is incomplete');

    expect(pdfQueue.redis.type).toHaveBeenCalledTimes(MAX_LEGACY_SCAN_KEYS);
    expect(legacyJob1.remove).not.toHaveBeenCalled();
    expect(legacyJob2.remove).not.toHaveBeenCalled();
    expect(repository.states.get('user-1:pdf-queue')?.cursor).toBe('7');

    await service().assertNoActiveAndRemove('user-1', tasks);

    expect(pdfQueue.redis.scan).toHaveBeenNthCalledWith(
      2,
      '7',
      'MATCH',
      'bull:pdf-queue:*',
      'COUNT',
      MAX_LEGACY_SCAN_KEYS
    );
    expect(repository.states.get('user-1:pdf-queue')?.completed).toBeTrue();
    expect(legacyJob1.remove).toHaveBeenCalledTimes(1);
    expect(legacyJob2.remove).toHaveBeenCalledTimes(1);
  });

  it('persists scan overflow because Redis COUNT is only a hint', async () => {
    const keys = Array.from({ length: MAX_LEGACY_SCAN_KEYS + 1 }, (_, index) =>
      pdfQueue.toKey(`legacy-${index}`)
    );
    pdfQueue.redis.scan.mockResolvedValue(['0', keys]);
    pdfQueue.redis.hget.mockImplementation(async (key: string) =>
      JSON.stringify({
        taskId: key.endsWith('legacy-100') ? 'task-1' : 'other-task',
      })
    );
    const target = job('legacy-100', 'task-1', 'waiting');
    pdfQueue.jobs.set('legacy-100', target);
    const tasks = [{ id: 'task-1', type: 'pdf_merge' as const }];

    await expect(
      service().assertNoActiveAndRemove('user-1', tasks)
    ).rejects.toThrow('Account task scan is incomplete');

    expect(repository.states.get('user-1:pdf-queue')?.pendingKeys).toEqual([
      pdfQueue.toKey('legacy-100'),
    ]);
    await service().assertNoActiveAndRemove('user-1', tasks);

    expect(target.remove).toHaveBeenCalledTimes(1);
  });

  it('aborts with service unavailable when any job removal fails', async () => {
    const removeError = new Error('redis unavailable');
    const queuedJob = job(
      'task-1',
      'task-1',
      'waiting',
      vi.fn().mockRejectedValue(removeError)
    );
    imageQueue.jobs.set('task-1', queuedJob);

    await expect(
      service().assertNoActiveAndRemove('user-1', [
        { id: 'task-1', type: 'compress' },
      ])
    ).rejects.toThrow('Account task cleanup is incomplete');
  });
});
