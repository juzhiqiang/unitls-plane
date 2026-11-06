import { Injectable } from '@nestjs/common';
import { DelayedError, type Job } from 'bullmq';
import { FilesService } from '../../files/files.service';
import {
  MiB,
  ResourcePool,
  resourceLimits,
  type ResourceLimits,
  type ResourceCost,
} from '../../../common/resources/resource-limits';
import { TaskResourceLimitError } from '../../../common/resources/resource-error';
import { runWithTaskResources } from '../../../common/resources/task-resource-context';

type ResourceTask = {
  type: string;
  userId?: string | null;
  inputFileIds?: string[] | null;
  inputConfig?: unknown;
};

/** 预留峰值展开空间；原生库/模型常驻内存需在部署层另留余量。 */
export function estimateTaskResources(
  type: string,
  inputBytes: number,
  limits: ResourceLimits
): ResourceCost {
  if (type === 'image_id_photo')
    return {
      memoryBytes: 256 * MiB + limits.imagePixels * 20 + inputBytes * 3,
      cpu: 2,
    };
  if (type === 'image_generate' || type === 'image_try_on')
    return {
      memoryBytes:
        128 * MiB +
        limits.imagePixels * 12 +
        limits.generatedImageBytes * 6 +
        inputBytes * 3,
      cpu: 1,
    };
  if (type === 'font_convert')
    return { memoryBytes: 128 * MiB + inputBytes * 8, cpu: 1 };
  if (type.startsWith('pdf_') || type.endsWith('_to_pdf')) {
    const raster = [
      'pdf_to_image',
      'pdf_compress',
      'pdf_to_cad',
      'pdf_from_document',
    ].includes(type)
      ? limits.pdfRenderPixels * 8 + limits.outputBytes * 3
      : 0;
    const images = type === 'image_to_pdf' ? limits.imagePixels * 12 : 0;
    return {
      memoryBytes: 128 * MiB + inputBytes * 4 + raster + images,
      cpu: 2,
    };
  }
  return {
    memoryBytes: 64 * MiB + limits.imagePixels * 12 + inputBytes * 3,
    cpu: 1,
  };
}

@Injectable()
export class TaskResourceBudgetService {
  private readonly limits = resourceLimits();
  private readonly pool = new ResourcePool(
    this.limits.memoryBytes,
    this.limits.cpu
  );

  constructor(private readonly filesService: FilesService) {}

  async run<T>(
    task: ResourceTask,
    job: Pick<Job, 'moveToDelayed'>,
    token: string | undefined,
    operation: () => Promise<T>
  ): Promise<T> {
    const config = task.inputConfig as {
      order?: string[];
      size?: string;
      references?: { source: string; inputIndex?: number }[];
    } | null;
    if (task.type === 'image_generate' || task.type === 'image_try_on') {
      const size =
        typeof config?.size === 'string'
          ? /^(\d+)x(\d+)$/.exec(config.size.trim())
          : null;
      if (size && Number(size[1]) * Number(size[2]) > this.limits.imagePixels)
        throw new TaskResourceLimitError(
          'requested output pixel budget exceeded'
        );
    }
    let ids = task.inputFileIds ?? [];
    if (
      (task.type === 'pdf_merge' || task.type === 'image_to_pdf') &&
      Array.isArray(config?.order)
    )
      ids = config.order;
    const libraryCount =
      task.type === 'image_try_on'
        ? (config?.references ?? []).filter(ref => ref.source === 'library')
            .length
        : 0;
    if (task.type === 'image_try_on' && Array.isArray(config?.references)) {
      ids = config.references
        .filter(ref => ref.source === 'upload')
        .map(ref => ids[ref.inputIndex ?? -1] ?? '');
    }
    if (ids.length + libraryCount > 100)
      throw new TaskResourceLimitError('too many input files');
    let inputBytes = libraryCount * this.limits.libraryImageBytes;
    const files = new Map<string, { originalSize: number; mimeType: string }>();
    for (const id of ids) {
      const file = await this.filesService.getById(id, task.userId ?? null);
      if (!Number.isSafeInteger(file.originalSize) || file.originalSize < 0)
        throw new TaskResourceLimitError('invalid input size');
      inputBytes += file.originalSize;
      if (inputBytes > this.limits.inputBytes)
        throw new TaskResourceLimitError('total input byte budget exceeded');
      const forceImage = [
        'compress',
        'convert',
        'image_watermark',
        'image_id_photo',
        'image_generate',
        'image_try_on',
        'image_to_pdf',
      ].includes(task.type);
      const forcePdf =
        task.type.startsWith('pdf_') && task.type !== 'pdf_from_document';
      files.set(file.storageKey, {
        originalSize: file.originalSize,
        mimeType: forceImage
          ? 'image/unknown'
          : forcePdf
            ? 'application/pdf'
            : file.mimeType,
      });
    }
    if (inputBytes > this.limits.inputBytes)
      throw new TaskResourceLimitError('total input byte budget exceeded');
    const release = this.pool.tryAcquire(
      estimateTaskResources(task.type, inputBytes, this.limits)
    );
    if (!release) {
      await job.moveToDelayed(
        Date.now() + 2000 + Math.floor(Math.random() * 1000),
        token
      );
      throw new DelayedError();
    }
    try {
      return await runWithTaskResources(
        { limits: this.limits, inputBytes, files },
        operation
      );
    } finally {
      release();
    }
  }
}
