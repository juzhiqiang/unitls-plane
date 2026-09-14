import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import {
  imageGenerateTaskConfigSchema,
  type ImageGenerateTaskConfig,
} from '@utils-plane/validators';
import { Job, UnrecoverableError } from 'bullmq';
import { ErrorCodes } from '../../../common/errors/error-codes';
import { FilesService } from '../../files/files.service';
import { markGeneratedImage } from '../services/generated-image-marker';
import {
  ImageGenerationError,
  ImageGenerationService,
  resolveAiImageModel,
} from '../services/image-generation.service';
import { TasksService } from '../tasks.service';
import { sanitizeImageError } from '../services/image-error-sanitizer';
import {
  isRetryableError,
  hasExhaustedAttempts,
  shouldRecordFailure,
} from './attempt-outcome';
import { getTaskOutputOwner } from './task-output-owner';

type AiImageTask = {
  id: string;
  type: string;
  userId?: string | null;
  inputFileIds?: string[] | null;
  inputConfig?: unknown;
  sessionId?: string | null;
};

/**
 * 任务里的用户 prompt,给失败脱敏用。
 *
 * 上游报错常把 prompt 原样回显,落库前必须整体剥掉;解析不出 config 时给空串,
 * 脱敏器会跳过空 secret。
 */
function taskPrompt(task: AiImageTask): string {
  const config = task.inputConfig as { prompt?: unknown } | null | undefined;
  return typeof config?.prompt === 'string' ? config.prompt : '';
}

/**
 * 生图是远程 HTTP 等待型负载,并发可以开高,单任务耗时可能到分钟级。
 * 不与 image-queue 共用:那里的 concurrency 是为 sharp/ONNX 的 CPU 负载调的。
 */
@Processor('ai-queue', {
  concurrency: workerConcurrency('AI_WORKER_CONCURRENCY', 8),
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
      throw await this.settleFailedAttempt(taskId, job, err, taskPrompt(task));
    }
  }

  /**
   * 单次 attempt 失败后的收尾。
   *
   * 关键是不要在还会重试的时候就把任务写成 failed:前端把 failed 当终态,写下去的那一刻
   * 轮询就停了,后面重试成功也不会再有人来看,页面永远停在报错上(产物只能去文件列表找)。
   * 所以还有重试机会时只把任务退回 pending,让页面继续等。
   *
   * 反过来,确定性失败(内容策略拒绝、来源不支持该模式)要立刻落库并用
   * UnrecoverableError 掐断后续 attempt —— 每次重试都是一次真实计费的上游请求。
   */
  private async settleFailedAttempt(
    taskId: string,
    job: Job,
    err: unknown,
    prompt: string
  ): Promise<unknown> {
    if (!shouldRecordFailure(job, err)) {
      await this.markRetryingSafely(taskId);
      return err;
    }

    await this.markFailedSafely(taskId, err, prompt);
    if (isRetryableError(err)) return err;
    return new UnrecoverableError(
      err instanceof Error ? err.message : 'Image generation failed'
    );
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

  /**
   * markFailed 写入的 message 会经公开的 GET /tasks/:id/status 外泄。
   * ImageGenerationError 的 message 已在来源层脱敏,直接落库;其余意外错误
   * (sharp、MinIO、校验抛错)先剥掉 prompt 回显与密钥形态再透出,给不出内容时
   * 回退通用文案 —— 原文始终进日志,真实原因不靠外泄。
   */
  private async markFailedSafely(
    taskId: string,
    err: unknown,
    prompt = ''
  ): Promise<void> {
    const known = err instanceof ImageGenerationError;
    if (!known) {
      this.logger.error(
        `AI image task ${taskId} failed unexpectedly: ${String(err)}`
      );
    }
    const sanitized = known
      ? err.message
      : sanitizeImageError(err instanceof Error ? err.message : err, [prompt]);

    try {
      await this.tasksService.markFailed(
        taskId,
        known ? err.code : ErrorCodes.AI_IMAGE_GENERATION_FAILED,
        sanitized || 'Image generation failed'
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
    // inpaint(局部重绘)现在支持:蒙版编辑器在前端画布上产出 base + mask 两个输入文件,
    // 能力校验(来源是否声明 inpaint)由 ImageGenerationService 在解析来源时完成。
    await this.reportProgress(task.id, job, 30);

    const references = await this.loadReferences(task, config.mode);

    // 粘性路由:同会话同模型沿用上次实际使用的来源(一组图效果稳定),
    // 新会话/新模型没有记录时服务层随机首发。历史任务(只带 providerId)不查,
    // 直接钉死来源,与旧行为一致。
    const preferredProviderId =
      config.model && task.sessionId && task.userId
        ? await this.tasksService
            .findLastImageGenerateProviderId(
              task.userId,
              task.sessionId,
              config.model
            )
            .catch(error => {
              // 查询失败不该挡住生成:退化成随机首发即可。
              this.logger.warn(
                `Sticky source lookup failed for task ${task.id}: ${(error as Error).message}`
              );
              return null;
            })
        : null;

    const generated = await this.imageGenerationService.generate(
      config,
      references,
      preferredProviderId ? { preferredProviderId } : undefined
    );
    await this.reportProgress(task.id, job, 80);

    // 模型与来源取实际出图的那一条:同模型多来源容错路由下,同会话也可能
    // 换过网关,EXIF 里记错等于产物标识作废。
    const marked = await markGeneratedImage(generated.buffer, {
      model: generated.model ?? resolveAiImageModel(),
      source: generated.providerId,
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

    // 实际出图的来源与模型写入 output_meta:同会话后续任务靠它粘住来源,
    // 也是产物追溯的服务端事实(与用户提交的 inputConfig 分开存)。
    await this.tasksService.markCompleted(task.id, outputFile.id, {
      providerId: generated.providerId,
      model: generated.model,
    });
    await job.updateProgress(100);
    return { outputFileId: outputFile.id };
  }

  /**
   * 图生图/融合的参考图(1..N 张)与局部重绘的 [原图, 蒙版]。
   *
   * getById 必须带 task.userId:它是文件归属校验,少了这个参数等于允许任务引用
   * 别人账号里的文件。schema 已保证各模式的数量区间,这里的兜底
   * 只为在数据异常时给出与其它失败一致的通用文案。
   */
  private async loadReferences(
    task: AiImageTask,
    mode: ImageGenerateTaskConfig['mode']
  ): Promise<Buffer[] | undefined> {
    if (mode !== 'image_to_image' && mode !== 'inpaint') return undefined;

    const fileIds = task.inputFileIds ?? [];
    if (fileIds.length === 0) {
      throw new ImageGenerationError(
        ErrorCodes.AI_IMAGE_GENERATION_FAILED,
        'No reference image was available for this generation'
      );
    }

    const files = await Promise.all(
      fileIds.map(fileId =>
        this.filesService.getById(fileId, task.userId ?? null)
      )
    );
    return Promise.all(
      files.map(file => this.filesService.download(file.storageKey))
    );
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job, err: Error) {
    this.logger.error(
      `Job ${job.id} failed (attempt ${job.attemptsMade}): ${err.message}`
    );
    // 兜底:process() 之外失败(例如 stalled 后被 BullMQ 判负)时任务不能停在 processing。
    if (hasExhaustedAttempts(job)) {
      const { taskId } = job.data as { taskId: string };
      await this.markFailedSafely(taskId, err);
    }
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string) {
    this.logger.warn(`Job ${jobId} stalled — will be retried by BullMQ`);
  }
}
import { workerConcurrency } from '../../../config/worker-concurrency';
