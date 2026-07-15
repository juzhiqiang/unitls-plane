import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Task } from '@utils-plane/db';
import { Job, Queue } from 'bullmq';
import { getTaskQueueName } from '../tasks/task-queue';
import { AccountRepository } from './account.repository';

export const MAX_LEGACY_SCAN_KEYS = 100;
export const MAX_LEGACY_SCAN_PAGES = 10;

type DeletionTask = Pick<Task, 'id' | 'type'>;
type TaskJob = Job<{ taskId?: string }>;
type ScanState = Awaited<
  ReturnType<AccountRepository['getOrCreateDeletionQueueScan']>
>;
type RedisScanClient = {
  scan(
    cursor: string,
    match: 'MATCH',
    pattern: string,
    count: 'COUNT',
    limit: number
  ): Promise<[string, string[]]>;
  type(key: string): Promise<string>;
  hget(key: string, field: string): Promise<string | null>;
};

@Injectable()
export class AccountTaskQueueService {
  constructor(
    @InjectQueue('image-queue') private readonly imageQueue: Queue,
    @InjectQueue('pdf-queue') private readonly pdfQueue: Queue,
    @InjectQueue('font-queue') private readonly fontQueue: Queue,
    private readonly repository: AccountRepository
  ) {}

  async assertNoActiveAndRemove(
    userId: string,
    tasks: DeletionTask[]
  ): Promise<void> {
    try {
      const jobs = await this.findTaskJobs(userId, tasks);
      const states = await Promise.all(jobs.map(job => job.getState()));

      if (states.includes('active')) {
        throw new ServiceUnavailableException('Account has active tasks');
      }

      await Promise.all(jobs.map(job => job.remove()));
    } catch (error) {
      if (
        error instanceof ServiceUnavailableException &&
        (error.message === 'Account has active tasks' ||
          error.message === 'Account task scan is incomplete')
      ) {
        throw error;
      }
      throw new ServiceUnavailableException(
        'Account task cleanup is incomplete'
      );
    }
  }

  private async findTaskJobs(
    userId: string,
    tasks: DeletionTask[]
  ): Promise<TaskJob[]> {
    const taskIdsByQueue = new Map<Queue, Set<string>>();
    const jobsByQueue = new Map<Queue, Map<string, TaskJob>>();

    for (const task of tasks) {
      const queue = this.getQueue(task.type);
      const deterministicJob = (await queue.getJob(task.id)) as
        | TaskJob
        | undefined;
      if (deterministicJob) {
        this.addJob(jobsByQueue, queue, deterministicJob);
      } else {
        const taskIds = taskIdsByQueue.get(queue) ?? new Set<string>();
        taskIds.add(task.id);
        taskIdsByQueue.set(queue, taskIds);
      }
    }

    let remainingKeys = MAX_LEGACY_SCAN_KEYS;
    let remainingPages = MAX_LEGACY_SCAN_PAGES;
    let incomplete = false;
    for (const [queue, taskIds] of taskIdsByQueue) {
      const result = await this.scanLegacyJobs(
        userId,
        queue,
        taskIds,
        remainingKeys,
        remainingPages
      );
      remainingKeys -= result.keysProcessed;
      remainingPages -= result.pagesScanned;
      if (!result.state.completed) {
        incomplete = true;
        continue;
      }
      for (const jobId of result.state.jobIds) {
        const job = (await queue.getJob(jobId)) as TaskJob | undefined;
        if (job) {
          this.addJob(jobsByQueue, queue, job);
        }
      }
    }

    if (incomplete) {
      throw new ServiceUnavailableException('Account task scan is incomplete');
    }

    return [...jobsByQueue.values()].flatMap(jobs => [...jobs.values()]);
  }

  private async scanLegacyJobs(
    userId: string,
    queue: Queue,
    taskIds: Set<string>,
    keyBudget: number,
    pageBudget: number
  ): Promise<{
    state: ScanState;
    keysProcessed: number;
    pagesScanned: number;
  }> {
    let state = await this.repository.getOrCreateDeletionQueueScan(
      userId,
      queue.name
    );
    let keysProcessed = 0;
    let pagesScanned = 0;
    const client = (await queue.client) as unknown as RedisScanClient;

    while (
      !state.completed &&
      keysProcessed < keyBudget &&
      pagesScanned < pageBudget
    ) {
      if (state.pendingKeys.length > 0) {
        const take = Math.min(
          state.pendingKeys.length,
          keyBudget - keysProcessed
        );
        const keys = state.pendingKeys.slice(0, take);
        const foundJobIds = await this.findLegacyJobIds(
          client,
          queue,
          keys,
          taskIds
        );
        const pendingKeys = state.pendingKeys.slice(take);
        state = await this.saveScanState(state, {
          cursor: state.cursor,
          completed: pendingKeys.length === 0 && state.cursor === '0',
          pendingKeys,
          jobIds: [...new Set([...state.jobIds, ...foundJobIds])],
        });
        keysProcessed += take;
        continue;
      }

      const remaining = keyBudget - keysProcessed;
      const [cursor, keys] = await client.scan(
        state.cursor,
        'MATCH',
        queue.toKey('*'),
        'COUNT',
        Math.max(1, Math.min(MAX_LEGACY_SCAN_KEYS, remaining))
      );
      pagesScanned += 1;
      state = await this.saveScanState(state, {
        cursor,
        completed: keys.length === 0 && cursor === '0',
        pendingKeys: keys,
        jobIds: state.jobIds,
      });
    }

    return { state, keysProcessed, pagesScanned };
  }

  private async findLegacyJobIds(
    client: RedisScanClient,
    queue: Queue,
    keys: string[],
    taskIds: Set<string>
  ): Promise<string[]> {
    const prefix = queue.toKey('');
    const jobIds: string[] = [];
    for (const key of keys) {
      if (!key.startsWith(prefix) || (await client.type(key)) !== 'hash') {
        continue;
      }
      const rawData = await client.hget(key, 'data');
      if (!rawData) continue;
      let data: { taskId?: unknown };
      try {
        data = JSON.parse(rawData) as { taskId?: unknown };
      } catch {
        continue;
      }
      if (typeof data.taskId === 'string' && taskIds.has(data.taskId)) {
        const jobId = key.slice(prefix.length);
        if (jobId) jobIds.push(jobId);
      }
    }
    return jobIds;
  }

  private async saveScanState(
    current: ScanState,
    state: Pick<ScanState, 'cursor' | 'completed' | 'pendingKeys' | 'jobIds'>
  ): Promise<ScanState> {
    const saved = await this.repository.saveDeletionQueueScan(
      current.userId,
      current.queueName,
      current.version,
      state
    );
    if (!saved) {
      throw new ServiceUnavailableException('Account task scan is incomplete');
    }
    return saved;
  }

  private addJob(
    jobsByQueue: Map<Queue, Map<string, TaskJob>>,
    queue: Queue,
    job: TaskJob
  ): void {
    const jobs = jobsByQueue.get(queue) ?? new Map<string, TaskJob>();
    jobs.set(String(job.id), job);
    jobsByQueue.set(queue, jobs);
  }

  private getQueue(type: Task['type']): Queue {
    switch (getTaskQueueName(type)) {
      case 'image-queue':
        return this.imageQueue;
      case 'pdf-queue':
        return this.pdfQueue;
      case 'font-queue':
        return this.fontQueue;
    }
  }
}
