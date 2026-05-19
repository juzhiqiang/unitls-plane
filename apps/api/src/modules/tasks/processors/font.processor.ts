import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';

@Processor('font-queue', { concurrency: 2 })
export class FontProcessor extends WorkerHost {
  private readonly logger = new Logger(FontProcessor.name);

  async process(job: Job): Promise<unknown> {
    this.logger.log(`Processing font job ${job.id}`);
    // 实际逻辑在 Phase 4 实现
    return {};
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`Job ${job.id} failed: ${err.message}`);
  }
}
