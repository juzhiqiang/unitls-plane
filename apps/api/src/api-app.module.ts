import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { bullConfig } from './config/bull.config';
import { throttleConfig } from './config/throttle.config';
import { AccountModule } from './modules/account/account.module';
import { TasksApiModule } from './modules/tasks/tasks-api.module';
import { AuthModule } from './modules/auth/auth.module';
import { FilesModule } from './modules/files/files.module';
import { HealthModule } from './modules/health/health.module';
import { AuthGuard } from './common/guards/auth.guard';
import { CustomThrottlerGuard } from './common/guards/custom-throttler.guard';
import { BasicAuthMiddleware } from './common/middleware/basic-auth.middleware';

/**
 * HTTP API 根模块：Controller、认证 Guard、限流、BullBoard 和中间件。
 * 这里不能导入 TasksWorkerModule，否则 API 进程会开始消费任务。
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    throttleConfig,
    bullConfig,
    TasksApiModule,
    AuthModule,
    FilesModule,
    HealthModule,
    AccountModule,
    BullBoardModule.forRoot({
      route: '/admin/queues',
      adapter: ExpressAdapter,
    }),
    BullBoardModule.forFeature(
      { name: 'image-queue', adapter: BullMQAdapter },
      { name: 'pdf-queue', adapter: BullMQAdapter },
      { name: 'font-queue', adapter: BullMQAdapter },
      { name: 'cleanup-queue', adapter: BullMQAdapter },
      { name: 'ai-queue', adapter: BullMQAdapter }
    ),
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: CustomThrottlerGuard },
  ],
})
export class ApiAppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(BasicAuthMiddleware).forRoutes('/admin/queues');
  }
}
