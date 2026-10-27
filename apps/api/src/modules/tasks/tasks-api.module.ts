import { Module } from '@nestjs/common';
import { FontsController } from './fonts.controller';
import { TasksController } from './tasks.controller';
import { TasksCoreModule } from './tasks-core.module';

/** HTTP 任务入口，只包含 Controller，不注册任何任务处理器。 */
@Module({
  imports: [TasksCoreModule],
  controllers: [TasksController, FontsController],
})
export class TasksApiModule {}
