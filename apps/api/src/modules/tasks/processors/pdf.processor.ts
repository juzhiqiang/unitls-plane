import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import * as archiver from 'archiver';
import { PdfService, type SplitOptions } from '../services/pdf.service';
import { FilesService } from '../../files/files.service';
import { TasksService } from '../tasks.service';

function streamToBuffer(archive: archiver.Archiver): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    archive.finalize();
  });
}

const MAX_TOTAL_PAGES = 500;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

@Processor('pdf-queue', {
  concurrency: 2,
  lockDuration: 300000,
})
export class PdfProcessor extends WorkerHost {
  private readonly logger = new Logger(PdfProcessor.name);

  constructor(
    private readonly pdfService: PdfService,
    private readonly filesService: FilesService,
    private readonly tasksService: TasksService,
  ) {
    super();
  }

  async process(job: Job<{ taskId: string }>): Promise<unknown> {
    const { taskId } = job.data;
    this.logger.log(`[START] jobId=${job.id}, taskId=${taskId}, attempt=${job.attemptsMade}`);
    const task = await this.tasksService.getById(taskId);

    try {
      await this.tasksService.markProcessing(taskId);

      switch (task.type) {
        case 'pdf_merge':
          return await this.handleMerge(task, job);
        case 'pdf_split':
          return await this.handleSplit(task, job);
        default:
          throw new Error(`Unknown pdf task type: ${task.type}`);
      }
    } catch (err) {
      try {
        await this.tasksService.markFailed(
          taskId,
          'PDF_PROCESSING_FAILED',
          (err as Error).message,
        );
      } catch (dbErr) {
        this.logger.error(`Failed to mark task ${taskId} as failed: ${(dbErr as Error).message}`);
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

  private async handleMerge(task: any, job: Job): Promise<unknown> {
    const config = task.inputConfig as { order?: string[]; outputFilename?: string };
    const orderedIds: string[] = config.order ?? task.inputFileIds;

    if (!orderedIds || orderedIds.length === 0) {
      throw new Error('No input files specified');
    }

    const inputs: Buffer[] = [];
    let totalPages = 0;

    for (let i = 0; i < orderedIds.length; i++) {
      const file = await this.filesService.getById(orderedIds[i]!);

      if (file.mimeType !== 'application/pdf') {
        throw new Error(`INVALID_FILE_TYPE: File ${file.filename} is not a PDF`);
      }

      if (file.originalSize > MAX_FILE_SIZE) {
        throw new Error(`File ${file.filename} exceeds 50MB limit`);
      }

      const buffer = await this.filesService.download(file.storageKey);
      const pageCount = await this.pdfService.getPageCount(buffer);
      totalPages += pageCount;

      if (totalPages > MAX_TOTAL_PAGES) {
        throw new Error(`Total page count (${totalPages}) exceeds limit of ${MAX_TOTAL_PAGES}`);
      }

      inputs.push(buffer);
      await this.reportProgress(task.id, job, Math.floor(((i + 1) / orderedIds.length) * 40));
    }

    const merged = await this.pdfService.merge(inputs);
    await this.reportProgress(task.id, job, 80);

    const outputFile = await this.filesService.upload(
      merged,
      {
        filename: config.outputFilename ?? 'merged.pdf',
        mimeType: 'application/pdf',
        size: merged.length,
      },
      task.userId ?? undefined,
    );
    await this.reportProgress(task.id, job, 95);

    await this.tasksService.markCompleted(task.id, outputFile.id);
    await this.reportProgress(task.id, job, 100);

    return { outputFileId: outputFile.id };
  }

  private async handleSplit(task: any, job: Job): Promise<unknown> {
    const fileId = task.inputFileIds?.[0];
    if (!fileId) throw new Error('No input file specified');

    const inputFile = await this.filesService.getById(fileId);

    if (inputFile.mimeType !== 'application/pdf') {
      throw new Error(`INVALID_FILE_TYPE: File ${inputFile.filename} is not a PDF`);
    }

    const inputBuffer = await this.filesService.download(inputFile.storageKey);
    await this.reportProgress(task.id, job, 20);

    const opts = task.inputConfig as SplitOptions;
    const outputs = await this.pdfService.split(inputBuffer, opts);
    await this.reportProgress(task.id, job, 60);

    let outputBuffer: Buffer;
    let outputName: string;
    let outputMime: string;

    if (outputs.length === 1) {
      outputBuffer = outputs[0]!;
      outputName = `split-${inputFile.filename}`;
      outputMime = 'application/pdf';
    } else {
      const archive = archiver.create('zip', {});
      outputs.forEach((buf, i) => {
        archive.append(buf, { name: `part-${i + 1}.pdf` });
      });
      outputBuffer = await streamToBuffer(archive);
      const baseName = inputFile.filename.replace(/\.pdf$/i, '');
      outputName = `split-${baseName}.zip`;
      outputMime = 'application/zip';
    }
    await this.reportProgress(task.id, job, 85);

    const outputFile = await this.filesService.upload(
      outputBuffer,
      {
        filename: outputName,
        mimeType: outputMime,
        size: outputBuffer.length,
      },
      task.userId ?? undefined,
    );

    await this.tasksService.markCompleted(task.id, outputFile.id);
    await this.reportProgress(task.id, job, 100);

    return { outputFileId: outputFile.id };
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job, err: Error) {
    this.logger.error(`Job ${job.id} failed (attempt ${job.attemptsMade}): ${err.message}`);
    const attemptsMade = job.attemptsMade;
    const maxAttempts = job.opts?.attempts ?? 3;
    if (attemptsMade >= maxAttempts) {
      const { taskId } = job.data as { taskId: string };
      await this.tasksService.markFailed(
        taskId,
        'PDF_PROCESSING_FAILED',
        err.message,
      );
    }
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string) {
    this.logger.warn(`Job ${jobId} stalled — will be retried by BullMQ`);
  }
}
