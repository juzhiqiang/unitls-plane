import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class CleanupScheduler implements OnModuleInit {
  constructor(
    @InjectQueue('cleanup-queue') private readonly cleanupQueue: Queue,
  ) {}

  async onModuleInit() {
    await this.cleanupQueue.add(
      'cleanup-expired-files',
      {},
      {
        repeat: { pattern: '0 * * * *' },
      },
    );
  }
}
