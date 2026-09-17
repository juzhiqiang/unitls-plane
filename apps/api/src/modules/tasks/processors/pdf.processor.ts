import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { Logger } from '@nestjs/common';
import * as archiver from 'archiver';
import {
  PDF_TO_CAD_MAX_FILE_SIZE,
  PDF_TO_CAD_MAX_PAGES,
  pdfToCadTaskConfigSchema,
} from '@utils-plane/validators';
import {
  PdfService,
  type SplitOptions,
  type ToTextOptions,
  type ImageToPdfOptions,
  type RotateOptions,
  type WatermarkOptions,
  type EncryptOptions,
  type CompressPdfOptions,
  type PdfMetadata,
  type RearrangeOptions,
  type DocumentToPdfOptions,
} from '../services/pdf.service';
import {
  PdfToCadService,
  type ConversionStage,
} from '../services/cad/pdf-to-cad.service';
import { CadError, isCadError } from '../services/cad/types';
import { FilesService } from '../../files/files.service';
import { TasksService } from '../tasks.service';
import {
  hasExhaustedAttempts,
  isRetryableError,
  shouldRecordFailure,
} from './attempt-outcome';
import { getTaskOutputOwner } from './task-output-owner';
import { workerConcurrency } from '../../../config/worker-concurrency';

type MupdfModule = typeof import('mupdf');
const nativeImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<MupdfModule>;
let mupdfPromise: Promise<MupdfModule> | undefined;

function getMupdf(): Promise<MupdfModule> {
  mupdfPromise ??= nativeImport('mupdf');
  return mupdfPromise;
}

function streamToBuffer(archive: archiver.Archiver): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    archive.finalize();
  });
}

// archiver 运行时是 v8(ESM,只导出 ZipArchive 类),@types/archiver 仍是 v7 的 create() 形状:
// archiver.create 在运行时是 undefined,拆分多份 / 多页转图片的 ZIP 分支之前一直会抛
// TypeError。与 account-export.service、cad-writer 相同的取法。
const ZipArchive = (
  archiver as unknown as {
    ZipArchive: new (options: { zlib: { level: number } }) => archiver.Archiver;
  }
).ZipArchive;

function createZipArchive(): archiver.Archiver {
  return new ZipArchive({ zlib: { level: 6 } });
}

const MAX_TOTAL_PAGES = 500;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

/** CAD 契约错误保留自己的错误码,其余一律归为 PDF_PROCESSING_FAILED。 */
function failureCodeOf(err: unknown): string {
  return isCadError(err) ? err.code : 'PDF_PROCESSING_FAILED';
}

/** 各阶段在任务进度条上的区间:解析 5→50,OCR 50→80,写出 80→90,上传收尾到 100。 */
const CAD_STAGE_PROGRESS: Record<ConversionStage, [number, number]> = {
  parse: [5, 50],
  ocr: [50, 80],
  write: [80, 90],
};

function inferDocumentFormat(
  filename: string,
  mimeType: string | null | undefined
): DocumentToPdfOptions['sourceFormat'] | null {
  const lowerName = filename.toLowerCase();
  if (
    lowerName.endsWith('.md') ||
    lowerName.endsWith('.markdown') ||
    mimeType === 'text/markdown'
  ) {
    return 'markdown';
  }
  if (
    lowerName.endsWith('.docx') ||
    mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx';
  }
  if (mimeType === 'text/plain') {
    return 'markdown';
  }
  return null;
}

function normalizePdfFilename(
  filename: string | undefined,
  fallback: string
): string {
  const value = (filename ?? fallback).trim();
  const withExt = value.toLowerCase().endsWith('.pdf') ? value : `${value}.pdf`;
  // eslint-disable-next-line no-control-regex -- Intentionally strips ASCII control characters from PDF filenames.
  return withExt.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') || fallback;
}

@Processor('pdf-queue', {
  concurrency: workerConcurrency('PDF_WORKER_CONCURRENCY', 2),
  lockDuration: 300000,
})
export class PdfProcessor extends WorkerHost {
  private readonly logger = new Logger(PdfProcessor.name);

  constructor(
    private readonly pdfService: PdfService,
    private readonly filesService: FilesService,
    private readonly tasksService: TasksService,
    private readonly pdfToCadService: PdfToCadService
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
        case 'pdf_merge':
          return await this.handleMerge(task, job);
        case 'pdf_split':
          return await this.handleSplit(task, job);
        case 'pdf_to_image':
          return await this.handleToImage(task, job);
        case 'pdf_to_text':
          return await this.handleToText(task, job);
        case 'image_to_pdf':
          return await this.handleImageToPdf(task, job);
        case 'pdf_rotate':
          return await this.handleRotate(task, job);
        case 'pdf_watermark':
          return await this.handleWatermark(task, job);
        case 'pdf_encrypt':
          return await this.handleEncrypt(task, job);
        case 'pdf_compress':
          return await this.handleCompressPdf(task, job);
        case 'pdf_metadata':
          return await this.handleMetadata(task, job);
        case 'pdf_rearrange':
          return await this.handleRearrange(task, job);
        case 'pdf_from_document':
          return await this.handleDocumentToPdf(task, job);
        case 'pdf_to_cad':
          return await this.handleToCad(task, job);
        default:
          throw new Error(`Unknown pdf task type: ${task.type}`);
      }
    } catch (err) {
      // 还有重试机会时只退回 pending:提前写 failed 会让前端停掉轮询,
      // 之后重试成功也没人再看,页面永远停在报错上。见 attempt-outcome.ts。
      if (!shouldRecordFailure(job, err)) {
        await this.markRetryingSafely(taskId);
        throw err;
      }
      try {
        await this.tasksService.markFailed(
          taskId,
          failureCodeOf(err),
          (err as Error).message
        );
      } catch (dbErr) {
        this.logger.error(
          `Failed to mark task ${taskId} as failed: ${(dbErr as Error).message}`
        );
      }
      // 确定性失败(CAD 契约错误:配置非法、DWG 未支持、OCR 缺失、损坏 PDF)重跑结果一样,
      // 用 UnrecoverableError 掐断后续 attempt,避免同一错误反复落库。
      if (isRetryableError(err)) throw err;
      throw new UnrecoverableError((err as Error).message);
    }
  }

  private async markRetryingSafely(taskId: string): Promise<void> {
    try {
      await this.tasksService.markRetrying(taskId);
    } catch (dbErr) {
      this.logger.error(
        `Failed to mark task ${taskId} for retry: ${(dbErr as Error).message}`
      );
    }
  }

  private async reportProgress(taskId: string, job: Job, value: number) {
    await Promise.all([
      job.updateProgress(value),
      this.tasksService.updateProgress(taskId, value),
    ]);
  }

  private async handleMerge(task: any, job: Job): Promise<unknown> {
    const config = task.inputConfig as {
      order?: string[];
      outputFilename?: string;
    };
    const orderedIds: string[] = config.order ?? task.inputFileIds;

    if (!orderedIds || orderedIds.length === 0) {
      throw new Error('No input files specified');
    }

    const inputs: Buffer[] = [];
    let totalPages = 0;

    for (let i = 0; i < orderedIds.length; i++) {
      const file = await this.filesService.getById(
        orderedIds[i]!,
        task.userId ?? null
      );

      if (file.mimeType !== 'application/pdf') {
        throw new Error(
          `INVALID_FILE_TYPE: File ${file.filename} is not a PDF`
        );
      }

      if (file.originalSize > MAX_FILE_SIZE) {
        throw new Error(`File ${file.filename} exceeds 50MB limit`);
      }

      const buffer = await this.filesService.download(file.storageKey);
      const pageCount = await this.pdfService.getPageCount(buffer);
      totalPages += pageCount;

      if (totalPages > MAX_TOTAL_PAGES) {
        throw new Error(
          `Total page count (${totalPages}) exceeds limit of ${MAX_TOTAL_PAGES}`
        );
      }

      inputs.push(buffer);
      await this.reportProgress(
        task.id,
        job,
        Math.floor(((i + 1) / orderedIds.length) * 40)
      );
    }

    const merged = await this.pdfService.merge(inputs);
    await this.reportProgress(task.id, job, 80);

    const outputOwner = await getTaskOutputOwner(task.userId);
    const outputFile = await this.filesService.upload(
      merged,
      {
        filename: config.outputFilename ?? 'merged.pdf',
        mimeType: 'application/pdf',
        size: merged.length,
      },
      outputOwner
    );
    await this.reportProgress(task.id, job, 95);

    await this.tasksService.markCompleted(task.id, outputFile.id);
    await this.reportProgress(task.id, job, 100);

    return { outputFileId: outputFile.id };
  }

  private async handleSplit(task: any, job: Job): Promise<unknown> {
    const fileId = task.inputFileIds?.[0];
    if (!fileId) throw new Error('No input file specified');

    const inputFile = await this.filesService.getById(
      fileId,
      task.userId ?? null
    );

    if (inputFile.mimeType !== 'application/pdf') {
      throw new Error(
        `INVALID_FILE_TYPE: File ${inputFile.filename} is not a PDF`
      );
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
      const archive = createZipArchive();
      outputs.forEach((buf, i) => {
        archive.append(buf, { name: `part-${i + 1}.pdf` });
      });
      outputBuffer = await streamToBuffer(archive);
      const baseName = inputFile.filename.replace(/\.pdf$/i, '');
      outputName = `split-${baseName}.zip`;
      outputMime = 'application/zip';
    }
    await this.reportProgress(task.id, job, 85);

    const outputOwner = await getTaskOutputOwner(task.userId);
    const outputFile = await this.filesService.upload(
      outputBuffer,
      {
        filename: outputName,
        mimeType: outputMime,
        size: outputBuffer.length,
      },
      outputOwner
    );

    await this.tasksService.markCompleted(task.id, outputFile.id);
    await this.reportProgress(task.id, job, 100);

    return { outputFileId: outputFile.id };
  }

  private async handleToImage(task: any, job: Job): Promise<unknown> {
    const fileId = task.inputFileIds?.[0];
    if (!fileId) throw new Error('No input file specified');

    const inputFile = await this.filesService.getById(
      fileId,
      task.userId ?? null
    );
    if (inputFile.mimeType !== 'application/pdf') {
      throw new Error(
        `INVALID_FILE_TYPE: File ${inputFile.filename} is not a PDF`
      );
    }

    const inputBuffer = await this.filesService.download(inputFile.storageKey);
    await this.reportProgress(task.id, job, 10);

    const config = task.inputConfig as {
      format?: 'png' | 'jpeg';
      dpi?: number;
      quality?: number;
      pages?: number[];
    };
    const format = config.format ?? 'png';
    const dpi = Math.min(Math.max(config.dpi ?? 150, 72), 600);
    const quality = Math.min(Math.max(config.quality ?? 85, 1), 100);
    const scale = dpi / 72;

    const mupdf = await getMupdf();
    const doc = mupdf.Document.openDocument(inputBuffer, 'application/pdf');
    const totalPages = doc.countPages();
    const pageIndices: number[] =
      config.pages ?? Array.from({ length: totalPages }, (_, i) => i);

    if (pageIndices.length === 0) {
      throw new Error('No pages selected for conversion');
    }

    const images: { name: string; data: Buffer }[] = [];

    for (let i = 0; i < pageIndices.length; i++) {
      const pageIdx = pageIndices[i]!;
      if (pageIdx < 0 || pageIdx >= totalPages) {
        throw new Error(
          `Invalid page index ${pageIdx}, total pages: ${totalPages}`
        );
      }

      const page = doc.loadPage(pageIdx);
      const pixmap = page.toPixmap(
        mupdf.Matrix.scale(scale, scale),
        mupdf.ColorSpace.DeviceRGB
      );

      let imageData: Buffer;
      const ext = format === 'jpeg' ? 'jpg' : 'png';

      if (format === 'jpeg') {
        imageData = Buffer.from(pixmap.asJPEG(quality));
      } else {
        imageData = Buffer.from(pixmap.asPNG());
      }

      images.push({
        name: `page-${pageIdx + 1}.${ext}`,
        data: imageData,
      });

      await this.reportProgress(
        task.id,
        job,
        10 + Math.floor(((i + 1) / pageIndices.length) * 70)
      );
    }

    let outputBuffer: Buffer;
    let outputName: string;
    let outputMime: string;

    const baseName = inputFile.filename.replace(/\.pdf$/i, '');

    if (images.length === 1) {
      outputBuffer = images[0]!.data;
      outputName = `${baseName}.${format === 'jpeg' ? 'jpg' : 'png'}`;
      outputMime = `image/${format}`;
    } else {
      const archive = createZipArchive();
      for (const img of images) {
        archive.append(img.data, { name: img.name });
      }
      outputBuffer = await streamToBuffer(archive);
      outputName = `${baseName}-images.zip`;
      outputMime = 'application/zip';
    }
    await this.reportProgress(task.id, job, 90);

    const outputOwner = await getTaskOutputOwner(task.userId);
    const outputFile = await this.filesService.upload(
      outputBuffer,
      {
        filename: outputName,
        mimeType: outputMime,
        size: outputBuffer.length,
      },
      outputOwner
    );

    await this.tasksService.markCompleted(task.id, outputFile.id);
    await this.reportProgress(task.id, job, 100);

    return { outputFileId: outputFile.id };
  }

  private async handleToText(task: any, job: Job): Promise<unknown> {
    const fileId = task.inputFileIds?.[0];
    if (!fileId) throw new Error('No input file specified');

    const inputFile = await this.filesService.getById(
      fileId,
      task.userId ?? null
    );
    if (inputFile.mimeType !== 'application/pdf') {
      throw new Error(
        `INVALID_FILE_TYPE: File ${inputFile.filename} is not a PDF`
      );
    }

    const inputBuffer = await this.filesService.download(inputFile.storageKey);
    await this.reportProgress(task.id, job, 10);

    const config = task.inputConfig as {
      format?: 'markdown' | 'text';
      pages?: number[];
      pageBreak?: 'hr' | 'newline' | 'none';
    };

    const pageBreakMap = {
      hr: '\n\n---\n\n',
      newline: '\n\n',
      none: '',
    };
    const pageBreak = pageBreakMap[config.pageBreak ?? 'hr'] ?? '\n\n---\n\n';

    const result = await this.pdfService.toText(inputBuffer, {
      format: config.format ?? 'markdown',
      pages: config.pages,
      pageBreak,
    });
    await this.reportProgress(task.id, job, 80);

    const ext = config.format === 'text' ? 'txt' : 'md';
    const baseName = inputFile.filename.replace(/\.pdf$/i, '');
    const outputBuffer = Buffer.from(result, 'utf-8');

    const outputOwner = await getTaskOutputOwner(task.userId);
    const outputFile = await this.filesService.upload(
      outputBuffer,
      {
        filename: `${baseName}.${ext}`,
        mimeType: 'text/plain',
        size: outputBuffer.length,
      },
      outputOwner
    );
    await this.reportProgress(task.id, job, 95);

    await this.tasksService.markCompleted(task.id, outputFile.id);
    await this.reportProgress(task.id, job, 100);

    return { outputFileId: outputFile.id };
  }

  private async handleImageToPdf(task: any, job: Job): Promise<unknown> {
    const fileIds: string[] = task.inputFileIds ?? [];
    if (fileIds.length === 0) throw new Error('No input files specified');

    const config = task.inputConfig as {
      pageSize?: 'original' | 'a4' | 'letter';
      fit?: 'fit' | 'fill' | 'stretch';
      order?: string[];
      outputFilename?: string;
    };

    const orderedIds: string[] = config.order ?? fileIds;

    const images: { buffer: Buffer; mimeType: string }[] = [];
    for (let i = 0; i < orderedIds.length; i++) {
      const file = await this.filesService.getById(
        orderedIds[i]!,
        task.userId ?? null
      );
      if (!file.mimeType.startsWith('image/')) {
        throw new Error(
          `INVALID_FILE_TYPE: File ${file.filename} is not an image`
        );
      }
      const buffer = await this.filesService.download(file.storageKey);
      images.push({ buffer, mimeType: file.mimeType });
      await this.reportProgress(
        task.id,
        job,
        Math.floor(((i + 1) / orderedIds.length) * 50)
      );
    }

    const pdfBuffer = await this.pdfService.imagesToPdf(images, {
      pageSize: config.pageSize ?? 'original',
      fit: config.fit ?? 'fit',
    });
    await this.reportProgress(task.id, job, 85);

    const outputOwner = await getTaskOutputOwner(task.userId);
    const outputFile = await this.filesService.upload(
      pdfBuffer,
      {
        filename: config.outputFilename ?? 'images.pdf',
        mimeType: 'application/pdf',
        size: pdfBuffer.length,
      },
      outputOwner
    );

    await this.tasksService.markCompleted(task.id, outputFile.id);
    await this.reportProgress(task.id, job, 100);
    return { outputFileId: outputFile.id };
  }

  private async handleDocumentToPdf(task: any, job: Job): Promise<unknown> {
    const fileId = task.inputFileIds?.[0];
    if (!fileId) throw new Error('No input file specified');

    const inputFile = await this.filesService.getById(
      fileId,
      task.userId ?? null
    );
    const inputBuffer = await this.filesService.download(inputFile.storageKey);
    await this.reportProgress(task.id, job, 20);

    const config = task.inputConfig as {
      sourceFormat?: 'markdown' | 'docx';
      outputFilename?: string;
    };
    const sourceFormat =
      config.sourceFormat ??
      inferDocumentFormat(inputFile.filename, inputFile.mimeType);

    if (!sourceFormat) {
      throw new Error(
        `INVALID_FILE_TYPE: File ${inputFile.filename} is not Markdown or Word`
      );
    }

    if (inputFile.originalSize > MAX_FILE_SIZE) {
      throw new Error(`File ${inputFile.filename} exceeds 50MB limit`);
    }

    const result = await this.pdfService.documentToPdf(
      {
        buffer: inputBuffer,
        filename: inputFile.filename,
        mimeType: inputFile.mimeType,
      },
      {
        sourceFormat,
      } satisfies DocumentToPdfOptions
    );
    await this.reportProgress(task.id, job, 85);

    const baseName = inputFile.filename.replace(/\.(md|markdown|docx)$/i, '');
    const outputName = normalizePdfFilename(
      config.outputFilename,
      `${baseName}.pdf`
    );
    const outputOwner = await getTaskOutputOwner(task.userId);
    const outputFile = await this.filesService.upload(
      result,
      {
        filename: outputName,
        mimeType: 'application/pdf',
        size: result.length,
      },
      outputOwner
    );

    await this.tasksService.markCompleted(task.id, outputFile.id);
    await this.reportProgress(task.id, job, 100);
    return { outputFileId: outputFile.id };
  }

  private async handleRotate(task: any, job: Job): Promise<unknown> {
    const fileId = task.inputFileIds?.[0];
    if (!fileId) throw new Error('No input file specified');

    const inputFile = await this.filesService.getById(
      fileId,
      task.userId ?? null
    );
    if (inputFile.mimeType !== 'application/pdf') {
      throw new Error(
        `INVALID_FILE_TYPE: File ${inputFile.filename} is not a PDF`
      );
    }

    const inputBuffer = await this.filesService.download(inputFile.storageKey);
    await this.reportProgress(task.id, job, 20);

    const config = task.inputConfig as {
      pages: number[];
      angle: 0 | 90 | 180 | 270;
    };
    if (!Array.isArray(config.pages) || config.pages.length === 0) {
      throw new Error('At least one page must be selected');
    }

    const result = await this.pdfService.rotate(inputBuffer, {
      pages: config.pages,
      angle: config.angle,
    });
    await this.reportProgress(task.id, job, 85);

    const outputOwner = await getTaskOutputOwner(task.userId);
    const outputFile = await this.filesService.upload(
      result,
      {
        filename: `rotated-${inputFile.filename}`,
        mimeType: 'application/pdf',
        size: result.length,
      },
      outputOwner
    );

    await this.tasksService.markCompleted(task.id, outputFile.id);
    await this.reportProgress(task.id, job, 100);
    return { outputFileId: outputFile.id };
  }

  private async handleWatermark(task: any, job: Job): Promise<unknown> {
    const fileId = task.inputFileIds?.[0];
    if (!fileId) throw new Error('No input file specified');

    const inputFile = await this.filesService.getById(
      fileId,
      task.userId ?? null
    );
    if (inputFile.mimeType !== 'application/pdf') {
      throw new Error(
        `INVALID_FILE_TYPE: File ${inputFile.filename} is not a PDF`
      );
    }

    const inputBuffer = await this.filesService.download(inputFile.storageKey);
    await this.reportProgress(task.id, job, 20);

    const config = task.inputConfig as {
      text: string;
      fontSize?: number;
      opacity?: number;
      color?: { r: number; g: number; b: number };
      rotation?: number;
      position?: 'center' | 'diagonal';
    };
    if (!config.text || config.text.trim().length === 0) {
      throw new Error('Watermark text is required');
    }

    const result = await this.pdfService.watermark(inputBuffer, {
      text: config.text,
      fontSize: config.fontSize,
      opacity: config.opacity,
      color: config.color,
      rotation: config.rotation,
      position: config.position,
    });
    await this.reportProgress(task.id, job, 85);

    const outputOwner = await getTaskOutputOwner(task.userId);
    const outputFile = await this.filesService.upload(
      result,
      {
        filename: `watermarked-${inputFile.filename}`,
        mimeType: 'application/pdf',
        size: result.length,
      },
      outputOwner
    );

    await this.tasksService.markCompleted(task.id, outputFile.id);
    await this.reportProgress(task.id, job, 100);
    return { outputFileId: outputFile.id };
  }

  private async handleEncrypt(task: any, job: Job): Promise<unknown> {
    const fileId = task.inputFileIds?.[0];
    if (!fileId) throw new Error('No input file specified');

    const inputFile = await this.filesService.getById(
      fileId,
      task.userId ?? null
    );
    if (inputFile.mimeType !== 'application/pdf') {
      throw new Error(
        `INVALID_FILE_TYPE: File ${inputFile.filename} is not a PDF`
      );
    }

    const inputBuffer = await this.filesService.download(inputFile.storageKey);
    await this.reportProgress(task.id, job, 20);

    const config = task.inputConfig as {
      userPassword?: string;
      ownerPassword: string;
      permissions?: {
        print?: boolean;
        copy?: boolean;
        modify?: boolean;
        annotate?: boolean;
      };
    };
    if (!config.ownerPassword) {
      throw new Error('Owner password is required');
    }

    const result = await this.pdfService.encrypt(inputBuffer, {
      userPassword: config.userPassword,
      ownerPassword: config.ownerPassword,
      permissions: config.permissions,
    });
    await this.reportProgress(task.id, job, 85);

    const outputOwner = await getTaskOutputOwner(task.userId);
    const outputFile = await this.filesService.upload(
      result,
      {
        filename: `encrypted-${inputFile.filename}`,
        mimeType: 'application/pdf',
        size: result.length,
      },
      outputOwner
    );

    await this.tasksService.markCompleted(task.id, outputFile.id);
    await this.reportProgress(task.id, job, 100);
    return { outputFileId: outputFile.id };
  }

  private async handleCompressPdf(task: any, job: Job): Promise<unknown> {
    const fileId = task.inputFileIds?.[0];
    if (!fileId) throw new Error('No input file specified');

    const inputFile = await this.filesService.getById(
      fileId,
      task.userId ?? null
    );
    if (inputFile.mimeType !== 'application/pdf') {
      throw new Error(
        `INVALID_FILE_TYPE: File ${inputFile.filename} is not a PDF`
      );
    }

    const inputBuffer = await this.filesService.download(inputFile.storageKey);
    const originalSize = inputBuffer.length;
    await this.reportProgress(task.id, job, 10);

    const config = task.inputConfig as { level?: 'light' | 'medium' | 'heavy' };
    const result = await this.pdfService.compressPdf(inputBuffer, {
      level: config.level ?? 'medium',
    });
    await this.reportProgress(task.id, job, 85);

    const outputOwner = await getTaskOutputOwner(task.userId);
    const outputFile = await this.filesService.upload(
      result,
      {
        filename: `compressed-${inputFile.filename}`,
        mimeType: 'application/pdf',
        size: result.length,
      },
      outputOwner
    );

    await this.tasksService.markCompleted(task.id, outputFile.id);
    await this.reportProgress(task.id, job, 100);
    return {
      outputFileId: outputFile.id,
      originalSize,
      compressedSize: result.length,
    };
  }

  private async handleMetadata(task: any, job: Job): Promise<unknown> {
    const fileId = task.inputFileIds?.[0];
    if (!fileId) throw new Error('No input file specified');

    const inputFile = await this.filesService.getById(
      fileId,
      task.userId ?? null
    );
    if (inputFile.mimeType !== 'application/pdf') {
      throw new Error(
        `INVALID_FILE_TYPE: File ${inputFile.filename} is not a PDF`
      );
    }

    const inputBuffer = await this.filesService.download(inputFile.storageKey);
    await this.reportProgress(task.id, job, 20);

    const config = task.inputConfig as {
      title?: string;
      author?: string;
      subject?: string;
      keywords?: string[];
      creator?: string;
      producer?: string;
    };

    const result = await this.pdfService.editMetadata(inputBuffer, config);
    await this.reportProgress(task.id, job, 85);

    const outputOwner = await getTaskOutputOwner(task.userId);
    const outputFile = await this.filesService.upload(
      result,
      {
        filename: inputFile.filename,
        mimeType: 'application/pdf',
        size: result.length,
      },
      outputOwner
    );

    await this.tasksService.markCompleted(task.id, outputFile.id);
    await this.reportProgress(task.id, job, 100);
    return { outputFileId: outputFile.id };
  }

  /**
   * PDF → CAD(首版 DXF)。
   *
   * 校验顺序:输入文件存在 → inputConfig 契约 → PDF 类型 → 50MB → 500 页,任何一步失败都是
   * CadError(不可重试),不会产出文件。DWG 与 OCR 前置检查由 PdfToCadService 在解析前完成。
   * 完成后把转换元数据写进 output_meta,前端据此展示实体/OCR 统计与降级说明。
   */
  private async handleToCad(task: any, job: Job): Promise<unknown> {
    const fileId = task.inputFileIds?.[0];
    if (!fileId) {
      throw new CadError('CAD_INVALID_CONFIG', 'No input file specified');
    }

    const parsed = pdfToCadTaskConfigSchema.safeParse(task.inputConfig ?? {});
    if (!parsed.success) {
      throw new CadError(
        'CAD_INVALID_CONFIG',
        `Invalid PDF to CAD config: ${parsed.error.issues
          .map(issue => `${issue.path.join('.') || 'config'}: ${issue.message}`)
          .join('; ')}`,
        { issues: parsed.error.issues.map(issue => issue.path.join('.')) }
      );
    }
    const config = parsed.data;

    const inputFile = await this.filesService.getById(
      fileId,
      task.userId ?? null
    );
    if (inputFile.mimeType !== 'application/pdf') {
      throw new CadError(
        'CAD_INVALID_CONFIG',
        `INVALID_FILE_TYPE: File ${inputFile.filename} is not a PDF`
      );
    }
    if (inputFile.originalSize > PDF_TO_CAD_MAX_FILE_SIZE) {
      throw new CadError(
        'CAD_INVALID_CONFIG',
        `File ${inputFile.filename} exceeds ${PDF_TO_CAD_MAX_FILE_SIZE / 1024 / 1024}MB limit`
      );
    }

    const inputBuffer = await this.filesService.download(inputFile.storageKey);
    let pageCount: number;
    try {
      pageCount = await this.pdfService.getPageCount(inputBuffer);
    } catch (err) {
      throw new CadError(
        'CAD_CONVERSION_FAILED',
        `Unable to read PDF: ${(err as Error).message}`
      );
    }
    if (pageCount > PDF_TO_CAD_MAX_PAGES) {
      throw new CadError(
        'CAD_INVALID_CONFIG',
        `PDF has ${pageCount} pages, exceeding the limit of ${PDF_TO_CAD_MAX_PAGES}`,
        { pageCount, limit: PDF_TO_CAD_MAX_PAGES }
      );
    }
    await this.reportProgress(task.id, job, 5);

    const result = await this.pdfToCadService.convert(inputBuffer, config, {
      baseName: inputFile.filename.replace(/\.pdf$/i, ''),
      onProgress: async (stage, fraction) => {
        const [from, to] = CAD_STAGE_PROGRESS[stage];
        await this.reportProgress(
          task.id,
          job,
          Math.round(from + (to - from) * Math.min(1, Math.max(0, fraction)))
        );
      },
    });
    await this.reportProgress(task.id, job, 90);

    const outputOwner = await getTaskOutputOwner(task.userId);
    const outputFile = await this.filesService.upload(
      result.output.data,
      {
        filename: result.output.filename,
        mimeType: result.output.mimeType,
        size: result.output.data.length,
      },
      outputOwner
    );
    await this.reportProgress(task.id, job, 95);

    await this.tasksService.markCompleted(task.id, outputFile.id, result.meta);
    await this.reportProgress(task.id, job, 100);
    return { outputFileId: outputFile.id, meta: result.meta };
  }

  private async handleRearrange(task: any, job: Job): Promise<unknown> {
    const fileId = task.inputFileIds?.[0];
    if (!fileId) throw new Error('No input file specified');

    const inputFile = await this.filesService.getById(
      fileId,
      task.userId ?? null
    );
    if (inputFile.mimeType !== 'application/pdf') {
      throw new Error(
        `INVALID_FILE_TYPE: File ${inputFile.filename} is not a PDF`
      );
    }

    const inputBuffer = await this.filesService.download(inputFile.storageKey);
    await this.reportProgress(task.id, job, 20);

    const config = task.inputConfig as { pageOrder: number[] };
    if (!Array.isArray(config.pageOrder) || config.pageOrder.length === 0) {
      throw new Error('Page order must not be empty');
    }

    const result = await this.pdfService.rearrange(inputBuffer, {
      pageOrder: config.pageOrder,
    });
    await this.reportProgress(task.id, job, 85);

    const outputOwner = await getTaskOutputOwner(task.userId);
    const outputFile = await this.filesService.upload(
      result,
      {
        filename: `rearranged-${inputFile.filename}`,
        mimeType: 'application/pdf',
        size: result.length,
      },
      outputOwner
    );

    await this.tasksService.markCompleted(task.id, outputFile.id);
    await this.reportProgress(task.id, job, 100);
    return { outputFileId: outputFile.id };
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job, err: Error) {
    this.logger.error(
      `Job ${job.id} failed (attempt ${job.attemptsMade}): ${err.message}`
    );
    if (hasExhaustedAttempts(job)) {
      const { taskId } = job.data as { taskId: string };
      await this.tasksService.markFailed(
        taskId,
        failureCodeOf(err),
        err.message
      );
    }
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string) {
    this.logger.warn(`Job ${jobId} stalled — will be retried by BullMQ`);
  }
}
