import { Module } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { db } from '@utils-plane/db';
import type { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import { FilesModule } from '../files/files.module';
import { MinioService } from '../files/minio.service';
import { HealthController } from './health.controller';
import { checkLibreOffice } from './libreoffice-health';
import {
  HEALTH_CHECKS,
  HealthService,
  type HealthChecks,
} from './health.service';

const queueNames = [
  'image-queue',
  'pdf-queue',
  'font-queue',
  'cleanup-queue',
] as const;

function assertRedisReady(
  client: { status: string },
  signal: globalThis.AbortSignal
): void {
  signal.throwIfAborted();
  if (client.status !== 'ready') {
    throw new Error('Redis client is not ready');
  }
}

@Module({
  imports: [
    FilesModule,
    BullModule.registerQueue(...queueNames.map(name => ({ name }))),
  ],
  controllers: [HealthController],
  providers: [
    HealthService,
    {
      provide: HEALTH_CHECKS,
      inject: [MinioService, ...queueNames.map(getQueueToken)],
      useFactory: (
        minioService: MinioService,
        imageQueue: Queue,
        pdfQueue: Queue,
        fontQueue: Queue,
        cleanupQueue: Queue
      ): HealthChecks => {
        const queues = [imageQueue, pdfQueue, fontQueue, cleanupQueue];

        return {
          database: async signal => {
            signal.throwIfAborted();
            await db.transaction(async tx => {
              signal.throwIfAborted();
              await tx.execute(sql`SET LOCAL statement_timeout = 2500`);
              signal.throwIfAborted();
              await tx.execute(sql`SELECT 1`);
            });
          },
          redis: async signal => {
            const redis = await imageQueue.client;
            assertRedisReady(redis, signal);
            await redis.ping();
          },
          minio: signal => minioService.checkBucket(signal),
          queues: async signal => {
            const clients = await Promise.all(
              queues.map(queue => queue.client)
            );
            for (const client of clients) {
              assertRedisReady(client, signal);
            }
            await Promise.all(queues.map(queue => queue.getJobCounts()));
          },
          libreOffice: () => checkLibreOffice(),
        };
      },
    },
  ],
})
export class HealthModule {}
