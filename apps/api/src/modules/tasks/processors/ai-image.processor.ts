import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Inject, Logger, Optional } from '@nestjs/common';
import {
  imageGenerateTaskConfigSchema,
  imageTryOnTaskConfigSchema,
  type ImageGenerateTaskConfig,
  type ImageTryOnReferenceBinding,
} from '@utils-plane/validators';
import { Job, UnrecoverableError } from 'bullmq';
import { ErrorCodes } from '../../../common/errors/error-codes';
import { FilesService } from '../../files/files.service';
import {
  AI_TRY_ON_REFERENCE_IMAGE_SOURCE,
  type AiTryOnReferenceImageSource,
  type AiTryOnReferencePromptMetadata,
} from '../services/ai-try-on-reference-image-source';
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
import { workerConcurrency } from '../../../config/worker-concurrency';

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
  const config = task.inputConfig as
    | { prompt?: unknown; promptAddition?: unknown }
    | null
    | undefined;
  if (typeof config?.prompt === 'string') return config.prompt;
  return typeof config?.promptAddition === 'string'
    ? config.promptAddition
    : '';
}

const TRY_ON_ROLE_ORDER: readonly ImageTryOnReferenceBinding['role'][] = [
  'person',
  'garment',
  'pose',
  'style',
];

const POSE_ANGLE_CAMERA_NOTES: Record<string, string> = {
  front: '正面（front view at chest height）',
  正面: '正面（front view at chest height）',
  diag: '斜侧（three-quarter view）',
  斜侧: '斜侧（three-quarter view）',
  side: '侧面（strict side profile）',
  侧面: '侧面（strict side profile）',
  high: '俯视（high angle, camera looking down）',
  俯视: '俯视（high angle, camera looking down）',
  高角度: '俯视（high angle, camera looking down）',
  low: '仰视（low angle, camera looking up）',
  仰视: '仰视（low angle, camera looking up）',
  低角度: '仰视（low angle, camera looking up）',
  back: '背面（back view）',
  背面: '背面（back view）',
};

export interface TryOnPromptMetadataMap {
  person?: AiTryOnReferencePromptMetadata | null;
  garment?: AiTryOnReferencePromptMetadata | null;
  pose?: AiTryOnReferencePromptMetadata | null;
  style?: AiTryOnReferencePromptMetadata | null;
}

function resolvePoseCameraNote(
  poseMeta?: AiTryOnReferencePromptMetadata | null
): string | null {
  if (!poseMeta) return null;
  for (const tag of poseMeta.tags) {
    const matched = POSE_ANGLE_CAMERA_NOTES[tag.toLowerCase()];
    if (matched) return matched;
  }
  for (const [key, note] of Object.entries(POSE_ANGLE_CAMERA_NOTES)) {
    if (poseMeta.titleZh.includes(key)) return note;
  }
  return null;
}

export function composeTryOnPrompt(
  mode: 'product' | 'inspiration',
  references: readonly ImageTryOnReferenceBinding[],
  promptAddition?: string,
  metadataByRole?: TryOnPromptMetadataMap
): string {
  const orderedRoles = TRY_ON_ROLE_ORDER.filter(role =>
    references.some(reference => reference.role === role)
  );
  const roleParts = orderedRoles.map((role, idx) => {
    const position = idx + 1;
    switch (role) {
      case 'person':
        return `第 ${position} 张是模特/人物参考`;
      case 'garment':
        return mode === 'product'
          ? `第 ${position} 张是本次要展示的真实商品服装图`
          : `第 ${position} 张是没有人物的目标服饰图`;
      case 'pose':
        return `第 ${position} 张是姿势结构线稿`;
      case 'style':
        return `第 ${position} 张是弱优先级的搭配风格参考`;
    }
  });

  const introTitle =
    mode === 'product'
      ? '生成真实、专业的电商服装试穿展示图。'
      : '生成真实、专业的穿搭灵感试穿展示图。';

  const lines: string[] = [
    `${introTitle}参考图按固定顺序提供：${roleParts.join('，')}。`,
    mode === 'product'
      ? '商品图是服装外观的唯一权威来源。尽可能准确保留商品的款式、颜色、图案、材质纹理、剪裁、层次、细节和配饰；将人物参考图中的原有衣物全部替换，不要保留第一张参考图上的原衣服，不要从姿势图或风格图复制、替换或改写商品设计，也不要画出商品图里的人台、假人模特、衣架或空白身体。'
      : '以目标服饰图决定主要服装的款式、颜色、图案、层次、鞋袜和配饰。目标服饰图只有衣服、没有人物，将人物完整换穿为这套目标服饰，人物参考图中的原衣服不要保留，也不要画出服饰图里的人台、假人模特或空白身体。',
  ];

  const garmentMeta = metadataByRole?.garment;
  if (garmentMeta) {
    const desc = garmentMeta.descriptionZh
      ? `（${garmentMeta.descriptionZh}）`
      : '';
    lines.push(`目标服饰描述：${garmentMeta.titleZh}${desc}。`);
  }

  lines.push(
    '人物（必须保持身份）：保留人物参考图中的五官、脸型、骨相、肤色、发型与发色，将目标服装自然穿在人物身上。这是成年人物，禁止画成儿童、幼儿或青少年，脸和身体都使用自然真实的成人比例。'
  );

  if (orderedRoles.includes('pose')) {
    lines.push(
      '姿势参考只控制人物动作和构图，不改变人物身份或服装。只从线稿提取身体姿态、重心、四肢位置、手部动作和镜头角度；不要把线稿轮廓、关节圆、骨骼连线、比例辅助线或线稿的空白身体画进成图。'
    );
    const poseMeta = metadataByRole?.pose;
    if (poseMeta) {
      const cameraNote = resolvePoseCameraNote(poseMeta);
      lines.push(
        `目标姿势：${poseMeta.titleZh}${cameraNote ? `。视角：${cameraNote}` : ''}。`
      );
    }
  }

  if (orderedRoles.includes('style')) {
    lines.push(
      '风格参考仅用于弱化的搭配氛围与光影参考，不得覆盖或改动目标服装的具体设计。'
    );
  }

  if (promptAddition?.trim()) {
    lines.push(`用户补充的场景要求：${promptAddition.trim()}`);
  } else {
    lines.push('画面补充：干净商业棚拍，柔和自然光影，真实面料质感与垂坠。');
  }

  lines.push(
    '生成干净、可信的电商展示摄影效果。不要水印，不要文字，不要画框外的说明。'
  );

  return lines.join('\n');
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
    private readonly imageGenerationService: ImageGenerationService,
    @Optional()
    @Inject(AI_TRY_ON_REFERENCE_IMAGE_SOURCE)
    private readonly tryOnReferenceImageSource?: AiTryOnReferenceImageSource
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
        case 'image_try_on':
          return await this.handleTryOn(task, job);
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
    return this.completeGeneratedImage(task, job, generated);
  }

  private async handleTryOn(task: AiImageTask, job: Job): Promise<unknown> {
    const config = imageTryOnTaskConfigSchema.parse({
      ...(task.inputConfig as Record<string, unknown>),
      inputFileCount: task.inputFileIds?.length ?? 0,
    });
    await this.reportProgress(task.id, job, 30);

    const [references, metadataByRole] = await Promise.all([
      this.loadTryOnReferences(task, config.references),
      this.loadTryOnPromptMetadata(config.references),
    ]);
    const imageConfig = imageGenerateTaskConfigSchema.parse({
      mode: 'image_to_image',
      prompt: composeTryOnPrompt(
        config.mode,
        config.references,
        config.promptAddition,
        metadataByRole
      ),
      size: config.size,
      quality: config.quality,
      model: config.model,
      inputFileCount: references.length,
    });
    const generated = await this.imageGenerationService.generate(
      imageConfig,
      references
    );
    return this.completeGeneratedImage(task, job, generated, 'ai-try-on');
  }

  private async completeGeneratedImage(
    task: AiImageTask,
    job: Job,
    generated: Awaited<ReturnType<ImageGenerationService['generate']>>,
    filenamePrefix = 'ai-image'
  ): Promise<unknown> {
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
        filename: `${filenamePrefix}-${task.id.slice(0, 8)}.${generated.extension}`,
        mimeType: generated.mimeType,
        size: marked.length,
      },
      outputOwner
    );
    await this.reportProgress(task.id, job, 95);

    // 实际出图的来源与模型写入 output_meta:同会话后续任务靠它粘住来源,
    // 也是产物追溯的服务端事实(与用户提交的 inputConfig 分开存)。
    // model = 真实上游名(产物追溯),displayModel = 归并键(粘性路由匹配)。
    await this.tasksService.markCompleted(task.id, outputFile.id, {
      providerId: generated.providerId,
      model: generated.model,
      displayModel: generated.displayModel,
    });
    await job.updateProgress(100);
    return { outputFileId: outputFile.id };
  }

  private async loadTryOnReferences(
    task: AiImageTask,
    bindings: readonly ImageTryOnReferenceBinding[]
  ): Promise<Buffer[]> {
    const roleOrder: ImageTryOnReferenceBinding['role'][] = [
      'person',
      'garment',
      'pose',
      'style',
    ];
    const orderedBindings = roleOrder.flatMap(role =>
      bindings.filter(binding => binding.role === role)
    );
    const files = task.inputFileIds ?? [];

    return Promise.all(
      orderedBindings.map(async binding => {
        if (binding.source === 'upload') {
          const fileId = files[binding.inputIndex];
          if (!fileId) {
            throw new ImageGenerationError(
              ErrorCodes.AI_IMAGE_GENERATION_FAILED,
              'A try-on reference file was not available'
            );
          }
          const file = await this.filesService.getById(
            fileId,
            task.userId ?? null
          );
          return this.filesService.download(file.storageKey);
        }

        if (!this.tryOnReferenceImageSource) {
          throw new ImageGenerationError(
            ErrorCodes.AI_IMAGE_GENERATION_FAILED,
            'Try-on reference library is unavailable'
          );
        }
        const expectedKind =
          binding.role === 'style' ? 'garment' : binding.role;
        return this.tryOnReferenceImageSource.getImageForGeneration(
          binding.assetId,
          expectedKind
        );
      })
    );
  }

  private async loadTryOnPromptMetadata(
    bindings: readonly ImageTryOnReferenceBinding[]
  ): Promise<TryOnPromptMetadataMap> {
    const getMeta = this.tryOnReferenceImageSource?.getPromptMetadata?.bind(
      this.tryOnReferenceImageSource
    );
    if (!getMeta) return {};

    const result: TryOnPromptMetadataMap = {};
    await Promise.all(
      bindings.map(async binding => {
        if (binding.source !== 'library') return;
        const expectedKind =
          binding.role === 'style' ? 'garment' : binding.role;
        try {
          result[binding.role] = await getMeta(binding.assetId, expectedKind);
        } catch {
          // 元数据仅用于增强提示词，读取失败不阻塞任务主流程
        }
      })
    );
    return result;
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
