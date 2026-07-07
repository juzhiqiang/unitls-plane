import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import {
  ImageService,
  type CompressOptions,
  type ConvertOptions,
  type WatermarkOptions,
} from '../services/image.service';
import { IdPhotoError, IdPhotoService } from '../services/id-photo.service';
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
    case 'jpeg':
    case 'jpg':
      return 'image/jpeg';
    default:
      return 'image/jpeg';
  }
}

function withWatermarkSuffix(filename: string, format?: string): string {
  const ext =
    format === 'jpeg' ? 'jpg' : (format ?? filename.split('.').pop() ?? 'jpg');
  const base = filename.replace(/\.[^.]+$/, '');
  return `watermarked-${base}.${ext}`;
}

type ImageTask = {
  id: string;
  userId?: string | null;
  inputFileIds?: string[] | null;
  inputConfig?: unknown;
};

@Processor('image-queue', {
  concurrency: 2,
  lockDuration: 300000,
})
export class ImageProcessor extends WorkerHost {
  private readonly logger = new Logger(ImageProcessor.name);

  constructor(
    private readonly imageService: ImageService,
    private readonly filesService: FilesService,
    private readonly tasksService: TasksService,
    private readonly idPhotoService: IdPhotoService
  ) {
    super();
  }

  async process(job: Job<{ taskId: string }>): Promise<unknown> {
    const { taskId } = job.data;
    this.logger.log(
      `[START] jobId=${job.id}, taskId=${taskId}, attempt=${job.attemptsMade}`
    );
    const task = await this.tasksService.getById(taskId);

    try {
      await this.tasksService.markProcessing(taskId);

      switch (task.type) {
        case 'compress':
          return await this.handleCompress(task, job);
        case 'convert':
          return await this.handleConvert(task, job);
        case 'image_watermark':
          return await this.handleWatermark(task, job);
        case 'image_id_photo':
          return await this.handleIdPhoto(task, job);
        default:
          throw new Error(`Unknown image task type: ${task.type}`);
      }
    } catch (err) {
      try {
        const code =
          err instanceof IdPhotoError
            ? err.code
            : 'IMAGE_PROCESSING_FAILED';
        await this.tasksService.markFailed(
          taskId,
          code,
          (err as Error).message
        );
      } catch (dbErr) {
        this.logger.error(
          `Failed to mark task ${taskId} as failed: ${(dbErr as Error).message}`
        );
      }
      throw err;
    }
  }

  private async reportProgress(taskId: string, job: Job, value: number) {
    await Promise.all([
      job.updateProgress(value),
      this.tasksService.updateProgress(taskId, value),
    ]);
  }

  private async handleCompress(task: ImageTask, job: Job): Promise<unknown> {
    const fileId = task.inputFileIds?.[0];
    if (!fileId) throw new Error('No input file specified');
    this.logger.log(
      `[compress] taskId=${task.id} downloading fileId=${fileId}`
    );
    const inputFile = await this.filesService.getById(fileId);
    const inputBuffer = await this.filesService.download(inputFile.storageKey);
    this.logger.log(
      `[compress] taskId=${task.id} downloaded ${inputBuffer.length} bytes`
    );
    await this.reportProgress(task.id, job, 20);

    const opts = task.inputConfig as CompressOptions;
    this.logger.log(
      `[compress] taskId=${task.id} starting sharp, format=${opts.format}`
    );
    const outputBuffer = await this.imageService.compress(inputBuffer, opts);
    this.logger.log(
      `[compress] taskId=${task.id} sharp done, output=${outputBuffer.length} bytes`
    );
    await this.reportProgress(task.id, job, 70);

    const outputFile = await this.filesService.upload(
      outputBuffer,
      {
        filename: `compressed-${inputFile.filename}`,
        mimeType: getMimeType(opts.format),
        size: outputBuffer.length,
      },
      task.userId ?? undefined
    );
    await this.reportProgress(task.id, job, 95);

    await this.tasksService.markCompleted(task.id, outputFile.id);
    await job.updateProgress(100);
    return { outputFileId: outputFile.id };
  }

  private async handleConvert(task: ImageTask, job: Job): Promise<unknown> {
    const fileId = task.inputFileIds?.[0];
    if (!fileId) throw new Error('No input file specified');
    const inputFile = await this.filesService.getById(fileId);
    const inputBuffer = await this.filesService.download(inputFile.storageKey);
    await this.reportProgress(task.id, job, 20);

    const opts = task.inputConfig as ConvertOptions;
    const meta = await this.imageService.getMetadata(inputBuffer);
    if (!meta.format) throw new Error('File is not a valid image');
    await this.reportProgress(task.id, job, 30);

    const outputBuffer = await this.imageService.convert(inputBuffer, opts);
    await this.reportProgress(task.id, job, 70);

    const ext = opts.toFormat;
    const newFilename = inputFile.filename.replace(/\.[^.]+$/, `.${ext}`);
    const outputFile = await this.filesService.upload(
      outputBuffer,
      {
        filename: newFilename,
        mimeType: getMimeType(ext),
        size: outputBuffer.length,
      },
      task.userId ?? undefined
    );
    await this.reportProgress(task.id, job, 95);

    await this.tasksService.markCompleted(task.id, outputFile.id);
    await job.updateProgress(100);
    return { outputFileId: outputFile.id };
  }

  private async handleWatermark(task: ImageTask, job: Job): Promise<unknown> {
    const fileId = task.inputFileIds?.[0];
    if (!fileId) throw new Error('No input file specified');
    const inputFile = await this.filesService.getById(fileId);
    if (!inputFile.mimeType.startsWith('image/')) {
      throw new Error(
        `INVALID_FILE_TYPE: File ${inputFile.filename} is not an image`
      );
    }

    const inputBuffer = await this.filesService.download(inputFile.storageKey);
    await this.reportProgress(task.id, job, 20);

    const opts = task.inputConfig as WatermarkOptions;
    if (!opts.text || opts.text.trim().length === 0) {
      throw new Error('Watermark text is required');
    }

    const outputBuffer = await this.imageService.watermark(inputBuffer, opts);
    await this.reportProgress(task.id, job, 75);

    const format =
      opts.outputFormat ?? inputFile.mimeType.replace('image/', '');
    const outputFile = await this.filesService.upload(
      outputBuffer,
      {
        filename: withWatermarkSuffix(inputFile.filename, format),
        mimeType: getMimeType(format),
        size: outputBuffer.length,
      },
      task.userId ?? undefined
    );
    await this.reportProgress(task.id, job, 95);

    await this.tasksService.markCompleted(task.id, outputFile.id);
    await job.updateProgress(100);
    return { outputFileId: outputFile.id };
  }

  private async handleIdPhoto(task: ImageTask, job: Job): Promise<unknown> {
    const fileId = task.inputFileIds?.[0];
    if (!fileId) throw new Error('No input file specified');
    const inputFile = await this.filesService.getById(fileId);
    if (!inputFile.mimeType.startsWith('image/')) {
      throw new Error(
        `INVALID_FILE_TYPE: File ${inputFile.filename} is not an image`
      );
    }

    const inputBuffer = await this.filesService.download(inputFile.storageKey);
    await this.reportProgress(task.id, job, 20);

    const output = await this.idPhotoService.render(
      inputBuffer,
      task.inputConfig as any
    );
    await this.reportProgress(task.id, job, 80);

    const base = inputFile.filename.replace(/\.[^.]+$/, '');
    const preset =
      typeof (task.inputConfig as any)?.preset === 'string'
        ? (task.inputConfig as any).preset
        : 'id';
    const outputFile = await this.filesService.upload(
      output.buffer,
      {
        filename: `id-photo-${preset}-${base}.${output.extension}`,
        mimeType: output.mimeType,
        size: output.buffer.length,
      },
      task.userId ?? undefined
    );
    await this.reportProgress(task.id, job, 95);

    await this.tasksService.markCompleted(task.id, outputFile.id);
    await job.updateProgress(100);
    return { outputFileId: outputFile.id };
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job, err: Error) {
    this.logger.error(
      `Job ${job.id} failed (attempt ${job.attemptsMade}): ${err.message}`
    );
    const attemptsMade = job.attemptsMade;
    const maxAttempts = job.opts?.attempts ?? 3;
    if (attemptsMade >= maxAttempts) {
      const { taskId } = job.data as { taskId: string };
      await this.tasksService.markFailed(
        taskId,
        'IMAGE_PROCESSING_FAILED',
        err.message
      );
    }
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string) {
    this.logger.warn(`Job ${jobId} stalled — will be retried by BullMQ`);
  }
}
