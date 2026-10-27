import { Module } from '@nestjs/common';
import { TasksCoreModule } from './tasks-core.module';
import { TasksApiModule } from './tasks-api.module';
import { TasksWorkerModule } from './tasks-worker.module';

/**
 * 兼容旧单进程部署的组合：同时启用 HTTP Controller 和任务处理器。
 * 新进程角色使用 TasksApiModule / TasksWorkerModule。
 */
@Module({
  imports: [TasksCoreModule, TasksApiModule, TasksWorkerModule],
})
export class TasksModule {}
