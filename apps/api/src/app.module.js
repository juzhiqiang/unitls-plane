var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { bullConfig } from './config/bull.config';
import { throttleConfig } from './config/throttle.config';
import { TasksModule } from './modules/tasks/tasks.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthGuard } from './common/guards/auth.guard';
import { CustomThrottlerGuard } from './common/guards/custom-throttler.guard';
let AppModule = class AppModule {
};
AppModule = __decorate([
    Module({
        imports: [
            ConfigModule.forRoot({ isGlobal: true }),
            throttleConfig,
            bullConfig,
            TasksModule,
            AuthModule,
            BullBoardModule.forRoot({
                route: '/admin/queues',
                adapter: ExpressAdapter,
            }),
            BullBoardModule.forFeature({ name: 'image-queue', adapter: BullMQAdapter }, { name: 'pdf-queue', adapter: BullMQAdapter }, { name: 'font-queue', adapter: BullMQAdapter }, { name: 'cleanup-queue', adapter: BullMQAdapter }),
        ],
        providers: [
            { provide: APP_GUARD, useClass: AuthGuard },
            { provide: APP_GUARD, useClass: CustomThrottlerGuard },
        ],
    })
], AppModule);
export { AppModule };
//# sourceMappingURL=app.module.js.map