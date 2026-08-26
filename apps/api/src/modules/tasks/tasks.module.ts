import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TasksController } from './tasks.controller';
import { FontsController } from './fonts.controller';
import { TasksService } from './tasks.service';
import { ImageProcessor } from './processors/image.processor';
import { PdfProcessor } from './processors/pdf.processor';
import { FontProcessor } from './processors/font.processor';
import { AiImageProcessor } from './processors/ai-image.processor';
import { CleanupProcessor } from './processors/cleanup.processor';
import { CleanupScheduler } from './processors/cleanup.scheduler';
import { ImageService } from './services/image.service';
import { IdPhotoService } from './services/id-photo.service';
import { PdfService } from './services/pdf.service';
import { FontService } from './services/font.service';
import { PortraitSegmentationService } from './services/portrait-segmentation.service';
import { ImageGenerationService } from './services/image-generation.service';
import { ImageGeneratePresetsService } from './services/image-generate-presets.service';
import { FilesModule } from '../files/files.module';
import { TaskJobReconciler } from './task-job-reconciler.service';
import { TaskJobStateRepository } from './task-job-state.repository';

@Module({
  imports: [
    FilesModule,
    BullModule.registerQueue(
      { name: 'image-queue' },
      { name: 'pdf-queue' },
      { name: 'font-queue' },
      { name: 'cleanup-queue' },
      { name: 'ai-queue' }
    ),
  ],
  controllers: [TasksController, FontsController],
  providers: [
    TasksService,
    TaskJobReconciler,
    TaskJobStateRepository,
    ImageService,
    IdPhotoService,
    PortraitSegmentationService,
    ImageGenerationService,
    ImageGeneratePresetsService,
    PdfService,
    FontService,
    ImageProcessor,
    PdfProcessor,
    FontProcessor,
    AiImageProcessor,
    CleanupProcessor,
    CleanupScheduler,
  ],
  exports: [TasksService, FontService],
})
export class TasksModule {}
