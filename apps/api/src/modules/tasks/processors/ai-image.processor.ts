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

function cleanGarmentReferenceLabel(
  garmentMeta?: AiTryOnReferencePromptMetadata | null
): string | null {
  if (!garmentMeta) return null;
  const cleanTitle = garmentMeta.titleZh
    .replace(/\s*\([A-Z]+-[A-Z0-9]+\)\s*$/i, '')
    .replace(/\s+[A-Z]+-\d+(?:-\d+)?\s*$/i, '')
    .trim();
  const cleanDesc = garmentMeta.descriptionZh?.trim();
  if (cleanTitle && cleanDesc) {
    return `${cleanTitle} · ${cleanDesc}`;
  }
  return cleanDesc || cleanTitle || null;
}

function cleanPersonReferenceLabel(
  personMeta?: AiTryOnReferencePromptMetadata | null
): string | null {
  if (!personMeta) return null;
  const cleaned = personMeta.titleZh
    .replace(/（正面人像）$/, '')
    .replace(/^(?:[^·]+·\s*)?/, '')
    .trim();
  return cleaned || personMeta.titleZh.trim() || null;
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
  const roleIndex = new Map<ImageTryOnReferenceBinding['role'], number>();
  const roleParts = orderedRoles.map((role, idx) => {
    const position = idx + 1;
    roleIndex.set(role, position);
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

  const personIdx = roleIndex.get('person') ?? 1;
  const garmentIdx = roleIndex.get('garment') ?? 2;
  const poseIdx = roleIndex.get('pose');
  const styleIdx = roleIndex.get('style');

  const personLabel = cleanPersonReferenceLabel(metadataByRole?.person);
  const personTraitNote = personLabel ? `（${personLabel}）` : '';

  const garmentLabel = cleanGarmentReferenceLabel(metadataByRole?.garment);
  const garmentNameNote = garmentLabel ? `（参考名称：${garmentLabel}）` : '';

  const lines: string[] = [
    `请根据提供的 ${orderedRoles.length} 张参考图，生成一张完整的真实商业试穿人物照片（参考图按固定顺序提供：${roleParts.join('，')}）：`,
    `• 人物：图${personIdx}中的人物，保持其脸型、五官、骨相、发型${personTraitNote}和发色一致。人物的肤色必须与图${personIdx}人物一致，所有裸露皮肤（包括四肢及服装镂空处露出的皮肤）必须与脸部肤色统一，统一后的肤色与质感按风格要求呈现；这是成年人物，禁止画成儿童、幼儿或青少年，脸和身体都使用自然真实的成人比例。`,
    mode === 'product'
      ? `• 服装：让人物穿上图${garmentIdx}中展示的真实商品服装和配饰${garmentNameNote}；商品图是服装外观的唯一权威来源，每件单品的款式、颜色、图案、材质纹理、剪裁、层次与配饰都以图${garmentIdx}为准，名称仅作辅助说明。完全替换图${personIdx}人物原有的衣物，不要从姿势图或风格图复制、替换或改写商品设计，也不要画出图${garmentIdx}中的人台、假人模特、衣架或空白身体。`
      : `• 服装：让人物穿上图${garmentIdx}中展示的整套服装和配饰${garmentNameNote}，每件单品的颜色、款式、图案、面料与配饰都以图${garmentIdx}为准，名称仅作辅助说明；图${garmentIdx}只有衣服、没有人物，完全替换图${personIdx}人物原有的衣物，不要画出图${garmentIdx}中的人台、假人模特或空白身体。`,
  ];

  if (poseIdx !== undefined) {
    const poseMeta = metadataByRole?.pose;
    const cameraNote = resolvePoseCameraNote(poseMeta);
    const poseTitle = poseMeta?.titleZh.trim();
    const poseNoteParts = [
      poseTitle,
      cameraNote ? `视角：${cameraNote}` : null,
    ].filter(Boolean);
    const poseDetailNote =
      poseNoteParts.length > 0 ? `（${poseNoteParts.join('，')}）` : '';

    lines.push(
      `• 姿势：按照图${poseIdx}中人体模型/线稿的动作和镜头角度摆姿势${poseDetailNote}；图${poseIdx}只是动作示意，只从线稿提取身体姿态、重心、四肢位置、手部动作和镜头角度，不要把线稿轮廓、关节圆、骨骼连线、比例辅助线或线稿的空白身体画进成图，最终画面中的人物是真人，皮肤真实自然，穿着图${garmentIdx}的服装。`
    );
  }

  const styleSegments = [
    '• 风格：写实商业摄影级质感，85mm 人像镜头，自然柔和光影，真实肌肤纹理与织物细节，8k 高清画质。人物比例协调，手部与五官自然，光影统一。',
  ];
  if (styleIdx !== undefined) {
    styleSegments.push(
      `图${styleIdx}仅用于弱化的搭配氛围与光影参考，不得覆盖或改动图${garmentIdx}目标服装的具体设计。`
    );
  }
  if (promptAddition?.trim()) {
    styleSegments.push(`用户补充的场景要求：${promptAddition.trim()}。`);
  }
  lines.push(styleSegments.join(' '));

  lines.push('画面中没有任何文字、标志、画框外说明或水印。');

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
