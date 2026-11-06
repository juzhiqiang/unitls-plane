import {
  Processor,
  WorkerHost,
  OnWorkerEvent,
  InjectQueue,
} from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { CleanupObligation } from '@utils-plane/db';
import { FilesService, type CleanupSummary } from '../../files/files.service';
import { MinioService } from '../../files/minio.service';
import { CleanupObligationService } from '../../files/cleanup-obligation.service';
import { TaskJobReconciler } from '../task-job-reconciler.service';
import { cleanupTaskSubmissions } from '../task-submissions';
import {
  ThumbnailCleanupService,
  type ThumbnailCleanupSummary,
} from '../../files/thumbnail-cleanup.service';

export type CleanupObligationSummary = {
  scanned: number;
  cleared: number;
  failed: number;
  clearedResourceIds: string[];
  failedResourceIds: string[];
};

@Processor('cleanup-queue')
export class CleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(CleanupProcessor.name);

  constructor(
    private readonly filesService: FilesService,
    private readonly minioService: MinioService,
    private readonly cleanupObligationService: CleanupObligationService,
    private readonly taskJobReconciler: TaskJobReconciler,
    private readonly thumbnailCleanup: ThumbnailCleanupService,
    @InjectQueue('cleanup-queue') private readonly cleanupQueue: Queue
  ) {
    super();
  }

  async process(
    job: Job
  ): Promise<
    | { expired: CleanupSummary; trash: CleanupSummary }
    | { orphanFileId: string }
    | CleanupObligationSummary
    | ThumbnailCleanupSummary
    | { submissionsCleaned: true }
  > {
    this.logger.log(`Processing cleanup job ${job.id}`);
    if (job.name === 'cleanup-task-submissions') {
      await cleanupTaskSubmissions();
      return { submissionsCleaned: true };
    }
    if (job.name === 'cleanup-orphan-thumbnails') {
      const { continuationToken, sweepId = job.id } = job.data as {
        continuationToken?: string;
        sweepId?: string;
      };
      const summary =
        await this.thumbnailCleanup.cleanupPage(continuationToken);
      if (summary.continuationToken) {
        const identity = createHash('sha256')
          .update(JSON.stringify([sweepId, summary.continuationToken]))
          .digest('hex');
        await this.cleanupQueue.add(
          'cleanup-orphan-thumbnails',
          {
            continuationToken: summary.continuationToken,
            sweepId,
          },
          {
            jobId: `thumbnail-sweep-${identity}`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: { age: 7 * 24 * 60 * 60, count: 10000 },
            removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 },
          }
        );
      }
      this.logger.log(
        `Thumbnail cleanup: deleted=${summary.deleted}/${summary.scanned}, failed=${summary.failed}`
      );
      return summary;
    }
    if (job.name === 'reconcile-cleanup-obligations') {
      return this.reconcileCleanupObligations();
    }

    if (job.name === 'delete-orphan-object') {
      const { storageKey, fileId } = job.data as {
        storageKey: string;
        fileId: string;
      };
      const fileExists = await this.cleanupObligationService.fileExists(fileId);
      if (!fileExists) await this.minioService.delete(storageKey);
      this.logger.log(
        `Orphan cleanup job ${job.id} completed for file ${fileId}`
      );
      return { orphanFileId: fileId };
    }

    const expired = await this.filesService.cleanupExpired();
    const trash = await this.filesService.cleanupTrashed();

    this.logger.log(
      `Cleanup job ${job.id} completed: expired=${expired.deleted}/${expired.scanned}, trash=${trash.deleted}/${trash.scanned}`
    );

    return { expired, trash };
  }

  private async reconcileCleanupObligations(): Promise<CleanupObligationSummary> {
    const obligations = await this.cleanupObligationService.list(100);
    const summary: CleanupObligationSummary = {
      scanned: obligations.length,
      cleared: 0,
      failed: 0,
      clearedResourceIds: [],
      failedResourceIds: [],
    };

    for (const obligation of obligations) {
      try {
        await this.reconcileCleanupObligation(obligation);
        summary.cleared += 1;
        summary.clearedResourceIds.push(obligation.resourceId);
      } catch {
        summary.failed += 1;
        summary.failedResourceIds.push(obligation.resourceId);
        try {
          await this.cleanupObligationService.defer(
            obligation.kind,
            obligation.resourceId
          );
        } catch {
          this.logger.error(
            `Failed to rotate cleanup obligation ${obligation.id} for resource ${obligation.resourceId}`
          );
        }
        this.logger.error(
          `Failed to reconcile cleanup obligation ${obligation.id} for resource ${obligation.resourceId}`
        );
      }
    }

    return summary;
  }

  private async reconcileCleanupObligation(
    obligation: CleanupObligation
  ): Promise<void> {
    if (obligation.kind === 'object') {
      const claimed = await this.cleanupObligationService.claimObjectCleanup(
        obligation.resourceId
      );
      if (!claimed) return;
      const fileExists = await this.cleanupObligationService.fileExists(
        obligation.resourceId
      );
      if (!fileExists) {
        if (!obligation.storageKey) throw new Error('Missing storage key');
        await this.minioService.delete(obligation.storageKey);
      }
      await this.cleanupObligationService.clear(
        obligation.kind,
        obligation.resourceId
      );
      return;
    }

    if (obligation.kind === 'task-job') {
      if (!obligation.queueName || !obligation.jobId) {
        throw new Error('Missing task job identity');
      }
      await this.taskJobReconciler.reconcile({
        resourceId: obligation.resourceId,
        queueName: obligation.queueName,
        jobId: obligation.jobId,
      });
      return;
    }

    throw new Error('Unsupported cleanup obligation kind');
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, _err: Error) {
    this.logger.error(`Job ${job.id} failed`);
  }
}
