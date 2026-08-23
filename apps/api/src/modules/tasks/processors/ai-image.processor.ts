import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import {
  imageGenerateTaskConfigSchema,
  type ImageGenerateTaskConfig,
} from '@utils-plane/validators';
import { Job } from 'bullmq';
import { ErrorCodes } from '../../../common/errors/error-codes';
import { FilesService } from '../../files/files.service';
import { markGeneratedImage } from '../services/generated-image-marker';
import {
  ImageGenerationError,
  ImageGenerationService,
  resolveAiImageModel,
} from '../services/image-generation.service';
import { TasksService } from '../tasks.service';
import { getTaskOutputOwner } from './task-output-owner';

type AiImageTask = {
  id: string;
  type: string;
  userId?: string | null;
  inputFileIds?: string[] | null;
  inputConfig?: unknown;
};

/**
 * 生图是远程 HTTP 等待型负载,并发可以开高,单任务耗时可能到分钟级。
 * 不与 image-queue 共用:那里的 concurrency 是为 sharp/ONNX 的 CPU 负载调的。
 */
@Processor('ai-queue', {
  concurrency: 8,
  lockDuration: 600000,
})
export class AiImageProcessor extends WorkerHost {
  private readonly logger = new Logger(AiImageProcessor.name);

  constructor(
    private readonly filesService: FilesService,
    private readonly tasksService: TasksService,
    private readonly imageGenerationService: ImageGenerationService
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
        case 'image_generate':
          return await this.handleGenerate(task, job);
        default:
          throw new Error(`Unknown AI image task type: ${task.type}`);
      }
    } catch (err) {
      await this.markFailedSafely(taskId, err);
      throw err;
    }
  }

  /**
   * markFailed 写入的 message 会经公开的 GET /tasks/:id/status 外泄。
   * 只有 ImageGenerationError 的固定文案可以落库,其余一律换成通用文案,
   * 原文进日志 —— provider 报错常回显用户 prompt。
   */
  private async markFailedSafely(taskId: string, err: unknown): Promise<void> {
    const known = err instanceof ImageGenerationError;
    if (!known) {
      this.logger.error(
        `AI image task ${taskId} failed unexpectedly: ${String(err)}`
      );
    }

    try {
      await this.tasksService.markFailed(
        taskId,
        known ? err.code : ErrorCodes.AI_IMAGE_GENERATION_FAILED,
        known ? err.message : 'Image generation failed'
      );
    } catch (dbErr) {
      this.logger.error(
        `Failed to mark task ${taskId} as failed: ${(dbErr as Error).message}`
      );
    }
  }

  private async reportProgress(taskId: string, job: Job, value: number) {
    await Promise.all([
      job.updateProgress(value),
      this.tasksService.updateProgress(taskId, value),
    ]);
  }

  private async handleGenerate(task: AiImageTask, job: Job): Promise<unknown> {
    const config = imageGenerateTaskConfigSchema.parse({
      ...(task.inputConfig as Record<string, unknown>),
      inputFileCount: task.inputFileIds?.length ?? 0,
    });
    if (config.mode === 'inpaint') {
      // 局部重绘还没实现:蒙版通道与画笔组件都不存在,先明确拒绝而不是把蒙版当参考图发出去。
      this.logger.warn(
        `AI image task ${task.id} requested unsupported inpaint`
      );
      throw new ImageGenerationError(
        ErrorCodes.AI_IMAGE_GENERATION_FAILED,
        'Image generation failed'
      );
    }
    await this.reportProgress(task.id, job, 30);

    const reference = await this.loadReference(task, config.mode);
    const generated = await this.imageGenerationService.generate(
      config,
      reference
    );
    await this.reportProgress(task.id, job, 80);

    const marked = await markGeneratedImage(generated.buffer, {
      model: resolveAiImageModel(),
      generatedAt: new Date(),
    });

    const outputOwner = await getTaskOutputOwner(task.userId);
    const outputFile = await this.filesService.upload(
      marked,
      {
        filename: `ai-image-${task.id.slice(0, 8)}.${generated.extension}`,
        mimeType: generated.mimeType,
        size: marked.length,
      },
      outputOwner
    );
    await this.reportProgress(task.id, job, 95);

    await this.tasksService.markCompleted(task.id, outputFile.id);
    await job.updateProgress(100);
    return { outputFileId: outputFile.id };
  }

  /**
   * 图生图的参考图。
   *
   * getById 必须带 task.userId:它是文件归属校验,少了这个参数等于允许任务引用
   * 别人账号里的文件。schema 已保证 image_to_image 恰好一个输入文件,这里的兜底
   * 只为在数据异常时给出与其它失败一致的通用文案。
   */
  private async loadReference(
    task: AiImageTask,
    mode: ImageGenerateTaskConfig['mode']
  ): Promise<Buffer | undefined> {
    if (mode !== 'image_to_image') return undefined;

    const fileId = task.inputFileIds?.[0];
    if (!fileId) {
      throw new ImageGenerationError(
        ErrorCodes.AI_IMAGE_GENERATION_FAILED,
        'Image generation failed'
      );
    }

    const inputFile = await this.filesService.getById(
      fileId,
      task.userId ?? null
    );
    return this.filesService.download(inputFile.storageKey);
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
      await this.markFailedSafely(taskId, err);
    }
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string) {
    this.logger.warn(`Job ${jobId} stalled — will be retried by BullMQ`);
  }
}
