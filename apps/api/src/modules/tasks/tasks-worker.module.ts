import { Module } from '@nestjs/common';
import { AiImageProcessor } from './processors/ai-image.processor';
import { CleanupProcessor } from './processors/cleanup.processor';
import { CleanupScheduler } from './processors/cleanup.scheduler';
import { FontProcessor } from './processors/font.processor';
import { ImageProcessor } from './processors/image.processor';
import { PdfProcessor } from './processors/pdf.processor';
import { TasksCoreModule } from './tasks-core.module';

/** 任务消费组合，不能注册 Controller、Swagger、BullBoard 或 HTTP Guard。 */
@Module({
  imports: [TasksCoreModule],
  providers: [
    ImageProcessor,
    PdfProcessor,
    FontProcessor,
    AiImageProcessor,
    CleanupProcessor,
    CleanupScheduler,
  ],
})
export class TasksWorkerModule {}
