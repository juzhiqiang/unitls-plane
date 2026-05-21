import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { ImageService, type CompressOptions, type ConvertOptions } from '../services/image.service';
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

      switch (task.type) {
        case 'compress':
          return await this.handleCompress(task, job);
        case 'convert':
          return await this.handleConvert(task, job);
        default:
          throw new Error(`Unknown image task type: ${task.type}`);
      }
    } catch (err) {
      await this.tasksService.markFailed(
        taskId,
        'IMAGE_PROCESSING_FAILED',
        (err as Error).message,
      );
      throw err;
    }
  }

  private async reportProgress(taskId: string, job: Job, value: number) {
    await Promise.all([
      job.updateProgress(value),
      this.tasksService.updateProgress(taskId, value),
    ]);
  }

  private async handleCompress(task: any, job: Job): Promise<unknown> {
    const fileId = task.inputFileIds?.[0];
    if (!fileId) throw new Error('No input file specified');
    const inputFile = await this.filesService.getById(fileId);
    const inputBuffer = await this.filesService.download(inputFile.storageKey);
    await this.reportProgress(task.id, job, 20);

    const opts = task.inputConfig as CompressOptions;
    const outputBuffer = await this.imageService.compress(inputBuffer, opts);
    await this.reportProgress(task.id, job, 70);

    const outputFile = await this.filesService.upload(
      outputBuffer,
      {
        filename: `compressed-${inputFile.filename}`,
        mimeType: getMimeType(opts.format),
        size: outputBuffer.length,
      },
      task.userId ?? undefined,
    );
    await this.reportProgress(task.id, job, 95);

    await this.tasksService.markCompleted(task.id, outputFile.id);
    await job.updateProgress(100);
    return { outputFileId: outputFile.id };
  }

  private async handleConvert(task: any, job: Job): Promise<unknown> {
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
      task.userId ?? undefined,
    );
    await this.reportProgress(task.id, job, 95);

    await this.tasksService.markCompleted(task.id, outputFile.id);
    await job.updateProgress(100);
    return { outputFileId: outputFile.id };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`Job ${job.id} failed: ${err.message}`);
  }
}
