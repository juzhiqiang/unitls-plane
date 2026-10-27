import { Module } from '@nestjs/common';
import { ApiAppModule } from './api-app.module';
import { WorkerAppModule } from './worker-app.module';

/**
 * 兼容旧部署的 all 组合：同一个进程同时提供 HTTP API 并消费任务。
 * 未设置 PROCESS_ROLE 时使用此模块。
 */
@Module({
  imports: [ApiAppModule, WorkerAppModule],
})
export class AppModule {}
