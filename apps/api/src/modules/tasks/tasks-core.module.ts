import { Module } from '@nestjs/common';
import { AccountSummaryCacheModule } from '../../common/cache/account-summary-cache.module';
import { BullModule } from '@nestjs/bullmq';
import { FilesModule } from '../files/files.module';
import { TaskJobReconciler } from './task-job-reconciler.service';
import { TaskJobStateRepository } from './task-job-state.repository';
import { TasksService } from './tasks.service';
import { ImageService } from './services/image.service';
import { IdPhotoService } from './services/id-photo.service';
import { PdfService } from './services/pdf.service';
import { PdfCadExtractorService } from './services/cad/pdf-cad-extractor.service';
import { PdfToCadService } from './services/cad/pdf-to-cad.service';
import { FontService } from './services/font.service';
import { PortraitSegmentationService } from './services/portrait-segmentation.service';
import { FaceDetectionService } from './services/face-detection.service';
import { ImageGenerationService } from './services/image-generation.service';
import { ImageGeneratePresetsService } from './services/image-generate-presets.service';

const taskQueueNames = [
  'image-queue',
  'pdf-queue',
  'font-queue',
  'cleanup-queue',
  'ai-queue',
] as const;

/**
 * API 与 Worker 共用的任务能力：队列注册、业务服务、数据库状态和文件依赖。
 * 这里不能注册 Processor、CleanupScheduler 或 HTTP Controller。
 */
@Module({
  imports: [
    AccountSummaryCacheModule,
    FilesModule,
    BullModule.registerQueue(...taskQueueNames.map(name => ({ name }))),
  ],
  providers: [
    TasksService,
    TaskJobReconciler,
    TaskJobStateRepository,
    ImageService,
    IdPhotoService,
    PortraitSegmentationService,
    FaceDetectionService,
    ImageGenerationService,
    ImageGeneratePresetsService,
    PdfService,
    PdfCadExtractorService,
    PdfToCadService,
    FontService,
  ],
  exports: [
    FilesModule,
    BullModule,
    TasksService,
    TaskJobReconciler,
    ImageService,
    IdPhotoService,
    PortraitSegmentationService,
    FaceDetectionService,
    ImageGenerationService,
    ImageGeneratePresetsService,
    PdfService,
    PdfCadExtractorService,
    PdfToCadService,
    FontService,
  ],
})
export class TasksCoreModule {}
