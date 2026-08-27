import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { CleanupObligationService } from '../files/cleanup-obligation.service';
import {
  getTaskQueueName,
  getTaskQueueAttempts,
  type TaskQueueName,
} from './task-queue';
import {
  TaskJobStateRepository,
  type TaskJobState,
} from './task-job-state.repository';

export type TaskJobIdentity = {
  resourceId: string;
  queueName: string;
  jobId: string;
};

const PENDING_HEALTHY_JOB_STATES = new Set([
  'active',
  'delayed',
  'prioritized',
  'waiting',
  'waiting-children',
]);

@Injectable()
export class TaskJobReconciler {
  constructor(
    @InjectQueue('image-queue') private readonly imageQueue: Queue,
    @InjectQueue('pdf-queue') private readonly pdfQueue: Queue,
    @InjectQueue('font-queue') private readonly fontQueue: Queue,
    @InjectQueue('ai-queue') private readonly aiQueue: Queue,
    private readonly cleanupObligationService: CleanupObligationService,
    private readonly stateRepository: TaskJobStateRepository
  ) {}

  async reconcile(identity: TaskJobIdentity): Promise<Job | null> {
    const recordedQueue = this.getQueue(identity.queueName);
    const state = await this.getTaskState(identity.resourceId);

    if (!this.hasActiveOwner(state) || this.isTerminal(state)) {
      await this.removeJobIfPresent(recordedQueue, identity.jobId);
      await this.clear(identity.resourceId);
      return null;
    }

    const desiredQueue = this.getQueue(getTaskQueueName(state.type));
    const desiredJobId = state.id;
    if (
      recordedQueue.name !== desiredQueue.name ||
      identity.jobId !== desiredJobId
    ) {
      await this.removeJobIfPresent(recordedQueue, identity.jobId);
    }

    let job = await desiredQueue.getJob(desiredJobId);
    if (state.status === 'pending') {
      job = await this.ensurePendingJob(desiredQueue, state, job);
    }

    const currentState = await this.getTaskState(identity.resourceId);
    if (!this.hasActiveOwner(currentState) || this.isTerminal(currentState)) {
      await this.removeJobIfPresent(desiredQueue, desiredJobId);
      await this.clear(identity.resourceId);
      return null;
    }

    if (currentState.status === 'processing') {
      if (!job || (await job.getState()) !== 'active') {
        if (job) await job.remove();
        await this.stateRepository.markProcessingFailed(identity.resourceId);
        await this.clear(identity.resourceId);
        return null;
      }
    }

    await this.clear(identity.resourceId);
    return job ?? null;
  }

  private async ensurePendingJob(
    queue: Queue,
    state: TaskJobState,
    existingJob: Job | undefined
  ): Promise<Job> {
    if (existingJob) {
      const existingState = await existingJob.getState();
      if (PENDING_HEALTHY_JOB_STATES.has(existingState)) return existingJob;
      await existingJob.remove();
    }

    const job = await queue.add(
      state.type,
      { taskId: state.id },
      {
        jobId: state.id,
        delay: 1000,
        attempts: getTaskQueueAttempts(queue.name),
      }
    );
    const addedState = await job.getState();
    if (!PENDING_HEALTHY_JOB_STATES.has(addedState)) {
      throw new Error(`Task job did not reach a healthy state: ${addedState}`);
    }
    return job;
  }

  private async removeJobIfPresent(queue: Queue, jobId: string): Promise<void> {
    const job = await queue.getJob(jobId);
    if (job) await job.remove();
  }

  private async clear(taskId: string): Promise<void> {
    await this.cleanupObligationService.clear('task-job', taskId);
  }

  private hasActiveOwner(state: TaskJobState | null): state is TaskJobState {
    if (!state) return false;
    if (!state.userId) return true;
    return state.ownerId === state.userId && !state.deletionStartedAt;
  }

  private isTerminal(state: TaskJobState | null): boolean {
    return state?.status === 'completed' || state?.status === 'failed';
  }

  private getTaskState(taskId: string): Promise<TaskJobState | null> {
    return this.stateRepository.getTaskState(taskId);
  }

  private getQueue(name: string): Queue {
    switch (name as TaskQueueName) {
      case 'image-queue':
        return this.imageQueue;
      case 'pdf-queue':
        return this.pdfQueue;
      case 'font-queue':
        return this.fontQueue;
      case 'ai-queue':
        return this.aiQueue;
      default:
        throw new Error(`Unsupported task queue ${name}`);
    }
  }
}
