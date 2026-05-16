# 06 - BullMQ 任务队列集成

> 依赖：01-nestjs-init、Phase 1 / 05-docker-services
> 预估：2h
> 可并行：与 02/03/04/05/08 同时执行

## 目标

集成 @nestjs/bullmq，定义 image/pdf/font 三个队列，连接本地 Redis。

## 步骤

### 6.1 安装依赖

```bash
cd apps/api
bun add @nestjs/bullmq bullmq ioredis
```

### 6.2 配置 BullModule

`apps/api/src/config/bull.config.ts`:
```typescript
import { BullModule } from '@nestjs/bullmq';

export const bullConfig = BullModule.forRootAsync({
  useFactory: () => ({
    connection: {
      url: process.env.REDIS_URL ?? 'redis://localhost:6379',
      maxRetriesPerRequest: null,  // BullMQ 要求
    },
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: { count: 100, age: 7 * 24 * 3600 },
      removeOnFail: { count: 500 },
    },
  }),
});
```

### 6.3 注册队列

`apps/api/src/modules/tasks/tasks.module.ts`:
```typescript
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'image-queue' },
      { name: 'pdf-queue' },
      { name: 'font-queue' },
    ),
  ],
})
export class TasksModule {}
```

### 6.4 创建 Processor 骨架（不实现具体逻辑）

`apps/api/src/modules/tasks/processors/image.processor.ts`:
```typescript
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';

@Processor('image-queue', { concurrency: 3 })
export class ImageProcessor extends WorkerHost {
  private readonly logger = new Logger(ImageProcessor.name);

  async process(job: Job): Promise<unknown> {
    this.logger.log(`Processing image job ${job.id}`);
    // 实际逻辑在 Phase 4 实现
    return {};
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`Job ${job.id} failed: ${err.message}`);
  }
}
```

同样创建 `pdf.processor.ts`、`font.processor.ts` 骨架。

### 6.5 集成 Bull Board（任务监控面板）

```bash
bun add @bull-board/express @bull-board/api @bull-board/nestjs
```

`apps/api/src/app.module.ts`:
```typescript
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';

@Module({
  imports: [
    BullBoardModule.forRoot({
      route: '/admin/queues',
      adapter: ExpressAdapter,
    }),
    BullBoardModule.forFeature(
      { name: 'image-queue', adapter: BullMQAdapter },
      { name: 'pdf-queue', adapter: BullMQAdapter },
      { name: 'font-queue', adapter: BullMQAdapter },
    ),
  ],
})
```

### 6.6 创建定时清理 Job

`apps/api/src/modules/tasks/processors/cleanup.processor.ts`:
```typescript
@Processor('cleanup-queue')
export class CleanupProcessor extends WorkerHost {
  async process(job: Job): Promise<unknown> {
    // 实际清理逻辑在 Phase 6 实现
    return {};
  }
}
```

注册 Repeatable Job（每小时执行一次）。

## 验收标准

- [ ] 三个队列在 Redis 中可见
- [ ] Bull Board 在 `/admin/queues` 可访问
- [ ] 测试 job 能被 dispatch 并触发 processor
- [ ] 失败重试机制工作（人为抛错验证）
