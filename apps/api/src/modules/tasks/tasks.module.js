var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { ImageProcessor } from './processors/image.processor';
import { PdfProcessor } from './processors/pdf.processor';
import { FontProcessor } from './processors/font.processor';
import { CleanupProcessor } from './processors/cleanup.processor';
import { CleanupScheduler } from './processors/cleanup.scheduler';
import { ImageService } from './services/image.service';
import { FilesModule } from '../files/files.module';
let TasksModule = class TasksModule {
};
TasksModule = __decorate([
    Module({
        imports: [
            FilesModule,
            BullModule.registerQueue({ name: 'image-queue' }, { name: 'pdf-queue' }, { name: 'font-queue' }, { name: 'cleanup-queue' }),
        ],
        controllers: [TasksController],
        providers: [
            TasksService,
            ImageService,
            ImageProcessor,
            PdfProcessor,
            FontProcessor,
            CleanupProcessor,
            CleanupScheduler,
        ],
        exports: [TasksService],
    })
], TasksModule);
export { TasksModule };
//# sourceMappingURL=tasks.module.js.map