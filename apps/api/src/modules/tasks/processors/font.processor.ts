import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { FontService, type FontConvertOptions } from '../services/font.service';
import { FilesService } from '../../files/files.service';
import { TasksService } from '../tasks.service';
import { getTaskOutputOwner } from './task-output-owner';

@Processor('font-queue', {
  concurrency: 2,
  lockDuration: 300000,
})
export class FontProcessor extends WorkerHost {
  private readonly logger = new Logger(FontProcessor.name);

  constructor(
    private readonly fontService: FontService,
    private readonly filesService: FilesService,
    private readonly tasksService: TasksService
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
      return await this.handleConvert(task, job);
    } catch (err) {
      try {
        await this.tasksService.markFailed(
          taskId,
          'FONT_PROCESSING_FAILED',
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

  private async handleConvert(task: any, job: Job): Promise<unknown> {
    const fileId = task.inputFileIds?.[0];
    if (!fileId) throw new Error('No input file specified');

    const inputFile = await this.filesService.getById(fileId);
    const inputBuffer = await this.filesService.download(inputFile.storageKey);
    await this.reportProgress(task.id, job, 20);

    const opts = task.inputConfig as FontConvertOptions;
    const output = await this.fontService.convert(inputBuffer, opts);
    await this.reportProgress(task.id, job, 80);

    const ext = opts.toFormat;
    const baseName = inputFile.filename.replace(/\.[^.]+$/, '');
    const outputOwner = await getTaskOutputOwner(task.userId);
    const outputFile = await this.filesService.upload(
      output,
      {
        filename: `${baseName}.${ext}`,
        mimeType: `font/${ext}`,
        size: output.length,
      },
      outputOwner
    );
    await this.reportProgress(task.id, job, 95);

    await this.tasksService.markCompleted(task.id, outputFile.id);
    await this.reportProgress(task.id, job, 100);

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
        'FONT_PROCESSING_FAILED',
        err.message
      );
    }
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string) {
    this.logger.warn(`Job ${jobId} stalled — will be retried by BullMQ`);
  }
}
