import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { bullConfig } from './config/bull.config';
import { WorkerApiMonitor } from './config/worker-api-monitor';
import { FilesModule } from './modules/files/files.module';
import { TasksWorkerModule } from './modules/tasks/tasks-worker.module';

/**
 * 任务 Worker 根模块：只加载队列和任务消费能力。
 * 不注册 HTTP Controller、Swagger、BullBoard、全局 Guard 或限流器。
 */
@Module({
  providers: [WorkerApiMonitor],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    bullConfig,
    FilesModule,
    TasksWorkerModule,
  ],
})
export class WorkerAppModule {}
