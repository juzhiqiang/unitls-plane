import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { bullConfig } from './config/bull.config';
import { throttleConfig } from './config/throttle.config';
import { AccountModule } from './modules/account/account.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { AuthModule } from './modules/auth/auth.module';
import { FilesModule } from './modules/files/files.module';
import { HealthModule } from './modules/health/health.module';
import { AuthGuard } from './common/guards/auth.guard';
import { CustomThrottlerGuard } from './common/guards/custom-throttler.guard';
import { BasicAuthMiddleware } from './common/middleware/basic-auth.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    throttleConfig,
    bullConfig,
    TasksModule,
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
      { name: 'cleanup-queue', adapter: BullMQAdapter }
    ),
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: CustomThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(BasicAuthMiddleware).forRoutes('/admin/queues');
  }
}
