import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { FilesService, type CleanupSummary } from '../../files/files.service';

@Processor('cleanup-queue')
export class CleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(CleanupProcessor.name);

  constructor(private readonly filesService: FilesService) {
    super();
  }

  async process(
    job: Job
  ): Promise<{ expired: CleanupSummary; trash: CleanupSummary }> {
    this.logger.log(`Processing cleanup job ${job.id}`);
    const expired = await this.filesService.cleanupExpired();
    const trash = await this.filesService.cleanupTrashed();

    this.logger.log(
      `Cleanup job ${job.id} completed: expired=${expired.deleted}/${expired.scanned}, trash=${trash.deleted}/${trash.scanned}`
    );

    return { expired, trash };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`Job ${job.id} failed: ${err.message}`);
  }
}
