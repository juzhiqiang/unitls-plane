import type { Task } from '@utils-plane/db';
import type { PdfToCadConversionMeta } from '@utils-plane/validators';
import type { FilesService } from '../../../files/files.service';
import type { TasksService } from '../../tasks.service';
import type { PdfService } from '../../services/pdf.service';
import type { PdfToCadService } from '../../services/cad/pdf-to-cad.service';
import { getTaskOutputOwner } from '../task-output-owner';
import type { PdfJob, PdfTaskResult } from './task.type';

/** 单次任务的 I/O 协作对象，统一双通道进度与产物上传、完成顺序。 */
export class PdfTaskContext {
  constructor(
    private readonly task: Task,
    private readonly job: PdfJob,
    readonly pdfService: PdfService,
    readonly filesService: FilesService,
    private readonly tasksService: TasksService,
    readonly pdfToCadService: PdfToCadService
  ) {}

  async reportProgress(value: number): Promise<void> {
    await Promise.all([
      this.job.updateProgress(value),
      this.tasksService.updateProgress(this.task.id, value),
    ]);
  }

  async readPdf(progress: number) {
    const fileId = this.task.inputFileIds?.[0];
    if (!fileId) throw new Error('No input file specified');
    const file = await this.filesService.getById(
      fileId,
      this.task.userId ?? null
    );
    if (file.mimeType !== 'application/pdf') {
      throw new Error(`INVALID_FILE_TYPE: File ${file.filename} is not a PDF`);
    }
    const buffer = await this.filesService.download(file.storageKey);
    await this.reportProgress(progress);
    return { file, buffer };
  }

  async completeOutput(
    buffer: Buffer,
    output: { filename: string; mimeType: string },
    options: {
      afterUploadProgress?: number;
      meta?: PdfToCadConversionMeta;
    } = {}
  ): Promise<PdfTaskResult> {
    const outputOwner = await getTaskOutputOwner(this.task.userId);
    const outputFile = await this.filesService.upload(
      buffer,
      { ...output, size: buffer.length },
      outputOwner
    );
    if (options.afterUploadProgress !== undefined) {
      await this.reportProgress(options.afterUploadProgress);
    }
    if (options.meta === undefined) {
      await this.tasksService.markCompleted(this.task.id, outputFile.id);
    } else {
      await this.tasksService.markCompleted(
        this.task.id,
        outputFile.id,
        options.meta
      );
    }
    await this.reportProgress(100);
    return options.meta === undefined
      ? { outputFileId: outputFile.id }
      : { outputFileId: outputFile.id, meta: options.meta };
  }
}
