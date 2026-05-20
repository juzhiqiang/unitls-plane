import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { ImageService, type CompressOptions } from '../services/image.service';
import { FilesService } from '../../files/files.service';
import { TasksService } from '../tasks.service';

function getMimeType(format?: string): string {
  switch (format) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'avif':
      return 'image/avif';
    default:
      return 'image/jpeg';
  }
}

@Processor('image-queue', { concurrency: 3 })
export class ImageProcessor extends WorkerHost {
  private readonly logger = new Logger(ImageProcessor.name);

  constructor(
    private readonly imageService: ImageService,
    private readonly filesService: FilesService,
    private readonly tasksService: TasksService,
  ) {
    super();
  }

  async process(job: Job<{ taskId: string }>): Promise<unknown> {
    const { taskId } = job.data;
    const task = await this.tasksService.getById(taskId);

    try {
      await this.tasksService.markProcessing(taskId);

      // 1. 下载输入文件
      const fileId = task.inputFileIds?.[0];
      if (!fileId) throw new Error('No input file specified');
      const inputFile = await this.filesService.getById(fileId);
      const inputBuffer = await this.filesService.download(
        inputFile.storageKey,
      );
      await job.updateProgress(20);

      // 2. 处理
      const opts = task.inputConfig as CompressOptions;
      const outputBuffer = await this.imageService.compress(inputBuffer, opts);
      await job.updateProgress(70);

      // 3. 上传结果
      const outputFile = await this.filesService.upload(
        outputBuffer,
        {
          filename: `compressed-${inputFile.filename}`,
          mimeType: getMimeType(opts.format),
          size: outputBuffer.length,
        },
        task.userId ?? undefined,
      );
      await job.updateProgress(95);

      // 4. 更新任务
      await this.tasksService.markCompleted(taskId, outputFile.id);
      await job.updateProgress(100);

      return { outputFileId: outputFile.id };
    } catch (err) {
      await this.tasksService.markFailed(
        taskId,
        'IMAGE_PROCESSING_FAILED',
        (err as Error).message,
      );
      throw err;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`Job ${job.id} failed: ${err.message}`);
  }
}
