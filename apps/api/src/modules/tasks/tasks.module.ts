import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TasksController } from './tasks.controller';
import { FontsController } from './fonts.controller';
import { TasksService } from './tasks.service';
import { ImageProcessor } from './processors/image.processor';
import { PdfProcessor } from './processors/pdf.processor';
import { FontProcessor } from './processors/font.processor';
import { CleanupProcessor } from './processors/cleanup.processor';
import { CleanupScheduler } from './processors/cleanup.scheduler';
import { ImageService } from './services/image.service';
import { PdfService } from './services/pdf.service';
import { FontService } from './services/font.service';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [
    FilesModule,
    BullModule.registerQueue(
      { name: 'image-queue' },
      { name: 'pdf-queue' },
      { name: 'font-queue' },
      { name: 'cleanup-queue' }
    ),
  ],
  controllers: [TasksController, FontsController],
  providers: [
    TasksService,
    ImageService,
    PdfService,
    FontService,
    ImageProcessor,
    PdfProcessor,
    FontProcessor,
    CleanupProcessor,
    CleanupScheduler,
  ],
  exports: [TasksService, FontService],
})
export class TasksModule {}
