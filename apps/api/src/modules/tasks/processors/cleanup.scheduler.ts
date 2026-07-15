import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class CleanupScheduler implements OnModuleInit {
  constructor(
    @InjectQueue('cleanup-queue') private readonly cleanupQueue: Queue
  ) {}

  async onModuleInit() {
    await Promise.all([
      this.cleanupQueue.add(
        'cleanup-expired-files',
        {},
        {
          jobId: 'hourly-file-retention',
          repeat: { pattern: '0 * * * *' },
        }
      ),
      this.cleanupQueue.add(
        'reconcile-cleanup-obligations',
        {},
        {
          jobId: 'minute-cleanup-obligations',
          repeat: { pattern: '* * * * *' },
        }
      ),
    ]);
  }
}
