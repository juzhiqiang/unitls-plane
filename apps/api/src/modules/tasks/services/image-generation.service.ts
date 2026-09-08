import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  IMAGE_GENERATE_INPAINT_PROMPT_PREFIX,
  type ImageGenerateStyle,
  type ImageGenerateTaskConfig,
} from '@utils-plane/validators';
import sharp from 'sharp';
import { ErrorCodes } from '../../../common/errors/error-codes';
import {
  DEFAULT_AI_IMAGE_MODEL,
  DEFAULT_AI_IMAGE_SIZES,
  LEGACY_PROVIDER_ID,
  loadImageProviderConfigs,
  resolveAiImageModel,
  resolveAiImageRequestTimeoutMs,
  type ImageProviderCapability,
  type ImageProviderConfig,
  type ImageProviderEditTransport,
  type ImageProviderOmittableBodyField,
  type ImageProviderRefEncoding,
} from './image-provider-config';
import {
  GeneratedImageDownloadError,
  bufferFromGeneratedImagePayload,
  normalizeOpenAiCompatibleImageEditUrl,
  normalizeOpenAiCompatibleImageGenerationUrl,
} from './openai-compatible-image';

export {
  DEFAULT_AI_IMAGE_MODEL,
  resolveAiImageModel,
} from './image-provider-config';

/** 上游报错里出现这些标记时判定为内容策略拒绝。 */
const CONTENT_REJECTION_MARKERS = [
  'content_policy',
  'content policy',
  'content_filter',
  'safety system',
  'moderation',
  'violation',
];

function isContentRejectionBody(body: string): boolean {
  const lowered = body.toLowerCase();
  return CONTENT_REJECTION_MARKERS.some(marker => lowered.includes(marker));
}

const STYLE_PROMPT_PREFIX: Record<ImageGenerateStyle, string> = {
  photographic:
    'A photorealistic photograph, natural lighting, sharp focus, 50mm lens. Subject: ',
  illustration:
    'A clean digital illustration, flat colors, confident linework. Subject: ',
  anime: 'Anime illustration, cel shading, expressive eyes. Subject: ',
  three_d:
    'A 3D rendered image, soft studio lighting, subtle depth of field. Subject: ',
  watercolor:
    'A watercolor painting, visible paper texture, soft bleeding edges. Subject: ',
  line_art:
    'Minimal black and white line art, uniform stroke width, no shading. Subject: ',
};

/**
 * 上游状态码里哪些值得再试一次。
 *
 * 5xx / 408 / 425 / 429 是「同一个请求过一会儿可能就成了」:网关 502、上游超时、限流。
 * 400/401/403/404 是确定性的(提示词违规、密钥错、模型不存在),重试只会再烧一次钱。
 */
function isTransientUpstreamStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 425 || status === 429;
}

export class ImageGenerationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /**
     * 下一次 attempt 有机会成功吗。默认 false:生图每次重试都是一次真实计费的上游请求,
     * 只有明确判定为瞬时故障(网关 5xx、超时、限流)的地方才显式打开。
     */
    readonly retryable = false
  ) {
    super(message);
    this.name = 'ImageGenerationError';
  }
}

/** 下发给前端的来源信息。只有这四个字段可以出网:baseUrl 与 apiKey 永不外泄。 */
export interface ImageProviderDescriptor {
  id: string;
  label: string;
  capabilities: ImageProviderCapability[];
  /** 该来源支持的尺寸,前端据此派生画面比例档位。 */
  sizes: string[];
}

export interface ImageGenerationProvider {
  /**
   * reference 只在 image_to_image 下有意义:文生图传了也会被忽略。
   * 多张 = 图片融合(全部参考图一起发给上游),1..IMAGE_GENERATE_MAX_REFERENCE_IMAGES。
   */
  generate(
    config: ImageGenerateTaskConfig,
    references?: Buffer[]
  ): Promise<Buffer>;
  readonly descriptor?: ImageProviderDescriptor;
  /** 实际请求用的模型,写进产物 EXIF。 */
  readonly model?: string;
}

export interface OpenAiCompatibleImageGenerationProviderOptions {
  id?: string;
  label?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  responseFormat?: string;
  capabilities?: ImageProviderCapability[];
  sizes?: string[];
  editTransport?: ImageProviderEditTransport;
  refImagesField?: string;
  refImageEncoding?: ImageProviderRefEncoding;
  /** 请求体里要省略的可选字段,给严格校验请求体的网关用。 */
  omitBodyFields?: ImageProviderOmittableBodyField[];
  /** 单次上游请求超时,超过即按失败处理。省略时从 AI_IMAGE_REQUEST_TIMEOUT_MS 解析。 */
  requestTimeoutMs?: number;
  fetch?: typeof fetch;
}

export function buildImageGenerationPrompt(
  config: Pick<ImageGenerateTaskConfig, 'prompt' | 'style'>
): string {
  const prefix = config.style ? STYLE_PROMPT_PREFIX[config.style] : '';
  return `${prefix}${config.prompt}`;
}

export class OpenAiCompatibleImageGenerationProvider implements ImageGenerationProvider {
  private readonly logger = new Logger(
    OpenAiCompatibleImageGenerationProvider.name
  );
  private readonly generationUrl: string;
  private readonly editUrl: string;
  private readonly apiKey?: string;
  readonly model: string;
  readonly descriptor: ImageProviderDescriptor;
  private readonly responseFormat: string;
  private readonly editTransport: ImageProviderEditTransport;
  private readonly refImagesField: string;
  private readonly refImageEncoding: ImageProviderRefEncoding;
  private readonly omitBodyFields: ReadonlySet<ImageProviderOmittableBodyField>;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor({
    id = LEGACY_PROVIDER_ID,
    label,
    baseUrl = process.env.AI_IMAGE_BASE_URL,
    apiKey = process.env.AI_IMAGE_API_KEY,
    model = resolveAiImageModel(),
    responseFormat = process.env.AI_IMAGE_RESPONSE_FORMAT || 'b64_json',
    capabilities = ['generate', 'edit'],
    sizes = [...DEFAULT_AI_IMAGE_SIZES],
    editTransport = 'multipart',
    refImagesField = 'reference_images',
    refImageEncoding = 'data_url',
    omitBodyFields = [],
    requestTimeoutMs = resolveAiImageRequestTimeoutMs(),
    fetch: fetchImpl = fetch,
  }: OpenAiCompatibleImageGenerationProviderOptions = {}) {
    if (!baseUrl) {
      throw new Error('AI_IMAGE_BASE_URL is not configured');
    }
    this.generationUrl = normalizeOpenAiCompatibleImageGenerationUrl(baseUrl);
    this.editUrl = normalizeOpenAiCompatibleImageEditUrl(baseUrl);
    this.apiKey = apiKey;
    this.model = model;
    this.descriptor = { id, label: label ?? id, capabilities, sizes };
    this.responseFormat = responseFormat;
    this.editTransport = editTransport;
    this.refImagesField = refImagesField;
    this.refImageEncoding = refImageEncoding;
    this.omitBodyFields = new Set(omitBodyFields);
    this.requestTimeoutMs = requestTimeoutMs;
    this.fetchImpl = fetchImpl;
  }

  static fromConfig(
    config: ImageProviderConfig,
    fetchImpl?: typeof fetch
  ): OpenAiCompatibleImageGenerationProvider {
    return new OpenAiCompatibleImageGenerationProvider({
      ...config,
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    });
  }

  /**
   * 给 fetch 套一个超时。挂死上游(连上 TLS、收了 body 却永不回响应)时,
   * 不靠它就会一直挂到 TCP keepalive,worker 整段时间被占死。
   * 超时统一抛 AbortError,外层兜成固定文案,不外泄。
   */
  private async fetchWithTimeout(
    url: string,
    init: RequestInit
  ): Promise<Response> {
    const response = await this.fetchImpl(url, {
      ...init,
      signal: globalThis.AbortSignal.timeout(this.requestTimeoutMs),
    });
    return response as Response;
  }

  async generate(
    config: ImageGenerateTaskConfig,
    references?: Buffer[]
  ): Promise<Buffer> {
    let response: Response;
    try {
      response =
        config.mode === 'text_to_image'
          ? await this.postGeneration(config)
          : await this.postEdit(config, references);
    } catch (error) {
      // provider 内部抛出的确定性错误(generations_ref 不支持局部重绘、缺参考图等)
      // 原样透传:它们不是网络故障,重试只会原样再失败一遍。
      if (error instanceof ImageGenerationError) throw error;
      // fetch 抛错(含超时 AbortError、DNS、连接重置)统一走兜底文案,原文只进日志。
      // 这类是瞬时故障,允许重试:实测网关偶发掐断连接,第二次往往就通了。
      this.logger.warn(
        `AI image generation request failed: provider=${this.descriptor.id} error=${String(error instanceof Error ? error.message : error)}`
      );
      throw new ImageGenerationError(
        ErrorCodes.AI_IMAGE_GENERATION_FAILED,
        'Image generation failed',
        true
      );
    }

    if (!response.ok) {
      throw this.toSanitizedError(
        response.status,
        await this.readBody(response)
      );
    }

    try {
      return await bufferFromGeneratedImagePayload(
        await response.json(),
        this.fetchImpl
      );
    } catch (error) {
      this.logger.warn(
        `AI image generation response could not be decoded: ${String(error)}`
      );
      // 图没取回来(网关抖动)可以重试;响应结构不认识是确定性问题,重试只会再烧一次钱。
      throw new ImageGenerationError(
        ErrorCodes.AI_IMAGE_GENERATION_FAILED,
        'Image generation failed',
        error instanceof GeneratedImageDownloadError
      );
    }
  }

  /**
   * 可选字段的名字与值。JSON 与 multipart 两条路都按这一份表拼,省得两边漏删。
   * model / prompt 不在表里:它们必发。值为 undefined 的行(如未选背景)在拼装时跳过。
   */
  private optionalBodyFields(
    config: ImageGenerateTaskConfig
  ): Array<[ImageProviderOmittableBodyField, string | number | undefined]> {
    return [
      ['size', config.size],
      ['quality', config.quality],
      ['response_format', this.responseFormat],
      ['n', 1],
      ['background', config.background],
    ];
  }

  private async postGeneration(
    config: ImageGenerateTaskConfig,
    extraBody: Record<string, unknown> = {}
  ): Promise<Response> {
    const body: Record<string, unknown> = {
      model: this.model,
      prompt: buildImageGenerationPrompt(config),
    };
    for (const [field, value] of this.optionalBodyFields(config)) {
      if (value === undefined) continue;
      if (!this.omitBodyFields.has(field)) body[field] = value;
    }

    return this.fetchWithTimeout(this.generationUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ ...body, ...extraBody }),
    });
  }

  /**
   * 图生图 / 图片融合 / 局部重绘。端点与传图方式按来源配置分支;文生图则所有来源共用 /v1/images/generations。
   *
   * 参考图先过 sharp:统一转 PNG、按 EXIF 方向摆正、压平透明通道并剥掉元数据
   * (局部重绘的透明蒙版例外 —— flatten 会把要重绘的透明区填成白色)。
   */
  private async postEdit(
    config: ImageGenerateTaskConfig,
    references?: Buffer[]
  ): Promise<Response> {
    const loaded = (references ?? []).filter(buffer => buffer.length > 0);
    if (loaded.length === 0) {
      this.logger.warn(
        'AI image edit requested without reference images; refusing to call upstream'
      );
      throw new ImageGenerationError(
        ErrorCodes.AI_IMAGE_GENERATION_FAILED,
        'Image generation failed'
      );
    }

    if (config.mode === 'inpaint') {
      return this.postInpaint(config, loaded);
    }
    return this.postReferencesEdit(config, loaded, config.prompt);
  }

  /** 单张参考图归一:统一 PNG、EXIF 摆正、剥元数据;默认压平透明通道(wan 系网关拒收带 alpha 的图)。 */
  private async normalizeReference(
    buffer: Buffer,
    keepAlpha = false
  ): Promise<Buffer> {
    const pipeline = sharp(buffer).rotate();
    return (keepAlpha ? pipeline : pipeline.flatten({ background: '#ffffff' }))
      .png()
      .toBuffer();
  }

  /** multipart 编辑表单:重复 image 字段(实测 wan 系网关认这个,OpenAI 官方的 image[] 反而会被拒)。 */
  private buildEditForm(
    config: ImageGenerateTaskConfig,
    images: Buffer[],
    prompt: string
  ): FormData {
    const form = new FormData();
    form.set('model', this.model);
    images.forEach((buffer, index) => {
      form.append(
        'image',
        new Blob([new Uint8Array(buffer)], { type: 'image/png' }),
        `source-${index + 1}.png`
      );
    });
    form.set('prompt', prompt);
    for (const [field, value] of this.optionalBodyFields(config)) {
      if (value === undefined) continue;
      if (!this.omitBodyFields.has(field)) form.set(field, String(value));
    }
    return form;
  }

  private async postForm(form: FormData): Promise<Response> {
    // 不要手写 Content-Type:multipart 的 boundary 只有 FormData 自己知道。
    return this.fetchWithTimeout(this.editUrl, {
      method: 'POST',
      headers: {
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: form,
    });
  }

  /**
   * 普通图生图 / 多图融合:全部参考图原样下发,提示词用用户原文(经 style 前缀组装)。
   * generations_ref 来源走 generations 端点的 JSON 数组。
   */
  private async postReferencesEdit(
    config: ImageGenerateTaskConfig,
    loaded: Buffer[],
    prompt: string
  ): Promise<Response> {
    const normalized = await Promise.all(
      loaded.map(buffer => this.normalizeReference(buffer))
    );

    if (this.editTransport === 'generations_ref') {
      // postGeneration 内部会再走一次 buildImageGenerationPrompt(style 前缀),
      // 这里只覆写 prompt 原文,避免双重前缀。
      return this.postGeneration(
        { ...config, prompt },
        { [this.refImagesField]: this.encodeReferences(normalized) }
      );
    }

    return this.postForm(
      this.buildEditForm(
        config,
        normalized,
        buildImageGenerationPrompt({ ...config, prompt })
      )
    );
  }

  private encodeReferences(images: Buffer[]): string[] {
    return images.map(buffer => {
      const base64 = buffer.toString('base64');
      return this.refImageEncoding === 'base64'
        ? base64
        : `data:image/png;base64,${base64}`;
    });
  }

  /**
   * 局部重绘双通道,官方优先:
   *
   * - 3 输入 = [原图, 透明蒙版, 红标记图]:先试官方 mask 通道(image + mask,
   *   蒙版透明区 = 重绘区,prompt 用用户原文);网关以确定性 4xx 且与内容策略
   *   无关的方式拒绝(典型:wan 系「未知文件字段:mask」)时,回退红标记通道。
   * - 2 输入 = [原图, 红标记图](旧格式):只走红标记通道。
   * - 红标记通道 = 两张普通参考图 + 固定提示词前缀(IMAGE_GENERATE_INPAINT_PROMPT_PREFIX)
   *   向模型说明红色区域的含义;generations_ref 表达不了 mask,一律走这条通道。
   */
  private async postInpaint(
    config: ImageGenerateTaskConfig,
    loaded: Buffer[]
  ): Promise<Response> {
    if (loaded.length !== 2 && loaded.length !== 3) {
      this.logger.warn(
        `AI image inpaint requires 2-3 inputs (image [mask] marked image), got ${loaded.length}`
      );
      throw new ImageGenerationError(
        ErrorCodes.AI_IMAGE_GENERATION_FAILED,
        'Image generation failed'
      );
    }

    const hasMask = loaded.length === 3;
    const maskEntry = hasMask ? loaded[1] : undefined;
    const markedEntry = loaded[hasMask ? 2 : 1];
    const baseEntry = loaded[0];
    if (!baseEntry || !markedEntry) {
      throw new ImageGenerationError(
        ErrorCodes.AI_IMAGE_GENERATION_FAILED,
        'Image generation failed'
      );
    }
    const base = await this.normalizeReference(baseEntry);
    const mask = maskEntry
      ? await this.normalizeReference(maskEntry, true)
      : undefined;
    const marked = await this.normalizeReference(markedEntry);

    // 红标记通道的提示词 = 固定前缀 + 用户原文;存量任务的 prompt 可能已带前缀,勿重复拼。
    const markedPrompt = config.prompt.startsWith(
      IMAGE_GENERATE_INPAINT_PROMPT_PREFIX
    )
      ? config.prompt
      : `${IMAGE_GENERATE_INPAINT_PROMPT_PREFIX}${config.prompt}`;

    if (this.editTransport === 'generations_ref') {
      return this.postGeneration(
        { ...config, prompt: markedPrompt },
        { [this.refImagesField]: this.encodeReferences([base, marked]) }
      );
    }

    // 官方 mask 通道优先。
    if (mask) {
      const form = this.buildEditForm(
        config,
        [base],
        buildImageGenerationPrompt(config)
      );
      form.append(
        'mask',
        new Blob([new Uint8Array(mask)], { type: 'image/png' }),
        'mask.png'
      );

      const response = await this.postForm(form);
      if (response.ok) return response;

      const status = response.status;
      const body = await this.readBody(response);
      // 回退条件:确定性 4xx 且与内容策略无关(换了通道也一样/不该再烧一次钱);
      // 瞬时故障(5xx/408/425/429)交给任务级重试,原通道再试即可。
      const fallbackEligible =
        status >= 400 &&
        status < 500 &&
        status !== 408 &&
        status !== 425 &&
        status !== 429 &&
        !isContentRejectionBody(body);
      if (!fallbackEligible) {
        throw this.toSanitizedError(status, body);
      }

      this.logger.warn(
        `Inpaint mask channel rejected by provider ${this.descriptor.id} (status=${status}), falling back to marked-image channel`
      );
    }

    // 红标记通道:双参考图 + 前缀提示词,与融合同传输。
    return this.postForm(
      this.buildEditForm(config, [base, marked], markedPrompt)
    );
  }

  private async readBody(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return '';
    }
  }

  /** 上游原文只进日志。抛出的 message 必须是固定文案,它会经公开的任务状态接口外泄。 */
  private toSanitizedError(status: number, body: string): ImageGenerationError {
    this.logger.warn(
      `AI image generation upstream failed: provider=${this.descriptor.id} status=${status} body=${body.slice(0, 2000)}`
    );

    const lowered = body.toLowerCase();
    const rejected = CONTENT_REJECTION_MARKERS.some(marker =>
      lowered.includes(marker)
    );

    // 内容策略拒绝重来一次也一样,不重试。其余按状态码判定瞬时性。
    return rejected
      ? new ImageGenerationError(
          ErrorCodes.AI_IMAGE_CONTENT_REJECTED,
          'The prompt was rejected by the provider content policy'
        )
      : new ImageGenerationError(
          ErrorCodes.AI_IMAGE_GENERATION_FAILED,
          'Image generation failed',
          isTransientUpstreamStatus(status)
        );
  }
}

export interface ImageGenerationServiceOptions {
  externalProvider?: ImageGenerationProvider | null;
  /** 多来源注入口,给测试与将来的自定义装配用;省略时从 AI_IMAGE_PROVIDERS 读取。 */
  providers?: ImageGenerationProvider[];
}

export interface GeneratedImage {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  /** 实际出图的来源与模型,供 processor 写入产物标识。 */
  providerId: string;
  model: string;
}

/** mode → 该模式要求来源具备的能力。 */
const REQUIRED_CAPABILITY: Record<
  ImageGenerateTaskConfig['mode'],
  ImageProviderCapability
> = {
  text_to_image: 'generate',
  image_to_image: 'edit',
  inpaint: 'inpaint',
};

@Injectable()
export class ImageGenerationService {
  private readonly logger = new Logger(ImageGenerationService.name);
  /** 插入顺序即配置顺序,第一项是默认来源。 */
  private readonly providers = new Map<string, ImageGenerationProvider>();

  constructor(@Optional() options?: ImageGenerationServiceOptions) {
    if (options?.providers) {
      for (const provider of options.providers) this.register(provider);
      return;
    }

    if (options && 'externalProvider' in options) {
      if (options.externalProvider) this.register(options.externalProvider);
      return;
    }

    // 配置非法时这里会抛错,进程起不来 —— 这是故意的,见 loadImageProviderConfigs。
    for (const config of loadImageProviderConfigs()) {
      this.register(OpenAiCompatibleImageGenerationProvider.fromConfig(config));
    }

    if (this.providers.size === 0) {
      this.logger.log(
        'Neither AI_IMAGE_PROVIDERS nor AI_IMAGE_BASE_URL is set; image generation stays disabled'
      );
    } else {
      this.logger.log(
        `Image generation providers: ${[...this.providers.keys()].join(', ')}`
      );
    }
  }

  private register(provider: ImageGenerationProvider): void {
    const id = provider.descriptor?.id ?? LEGACY_PROVIDER_ID;
    this.providers.set(id.toLowerCase(), provider);
  }

  get configured(): boolean {
    return this.providers.size > 0;
  }

  /** 供 GET /tasks/image-generate/providers 使用,顺序即配置顺序。 */
  listProviders(): ImageProviderDescriptor[] {
    return [...this.providers.entries()].map(([id, provider]) => ({
      id: provider.descriptor?.id ?? id,
      label: provider.descriptor?.label ?? id,
      capabilities: provider.descriptor?.capabilities ?? ['generate', 'edit'],
      sizes: provider.descriptor?.sizes ?? [...DEFAULT_AI_IMAGE_SIZES],
    }));
  }

  /**
   * 按 providerId 取来源。
   *
   * 没带 providerId 走第一个(历史任务与单来源部署);带了但不存在或不支持该模式时
   * 直接失败,不静默换一个来源 —— 用户选了哪个来源就该用哪个,悄悄换掉等于骗人。
   */
  private resolveProvider(
    config: ImageGenerateTaskConfig
  ): ImageGenerationProvider {
    const [fallback] = this.providers.values();
    if (!fallback) {
      throw new ImageGenerationError(
        ErrorCodes.AI_IMAGE_NOT_CONFIGURED,
        'AI image generation is not configured'
      );
    }

    const requested = config.providerId?.trim().toLowerCase();
    const provider = requested ? this.providers.get(requested) : fallback;
    if (!provider) {
      this.logger.warn(`Unknown image provider requested: ${requested}`);
      throw new ImageGenerationError(
        ErrorCodes.AI_IMAGE_PROVIDER_UNAVAILABLE,
        'The selected image provider is unavailable'
      );
    }

    const required = REQUIRED_CAPABILITY[config.mode];
    const capabilities = provider.descriptor?.capabilities;
    if (capabilities && !capabilities.includes(required)) {
      this.logger.warn(
        `Image provider ${provider.descriptor?.id} does not support ${config.mode}`
      );
      throw new ImageGenerationError(
        ErrorCodes.AI_IMAGE_PROVIDER_UNAVAILABLE,
        'The selected image provider does not support this mode'
      );
    }

    // 尺寸交叉校验:前端的画面比例 chips 由 provider.sizes 派生,正常流程到不了这里;
    // 只有旧缓存客户端或对已收窄 sizes 的来源重试旧任务时触发,按不可用处理。
    // 注入的 externalProvider 没有 descriptor.sizes 时跳过(单来源部署默认四档)。
    const sizes = provider.descriptor?.sizes;
    if (sizes && !sizes.includes(config.size)) {
      this.logger.warn(
        `Image provider ${provider.descriptor?.id} does not support size ${config.size}`
      );
      throw new ImageGenerationError(
        ErrorCodes.AI_IMAGE_PROVIDER_UNAVAILABLE,
        'The selected image provider does not support the requested size'
      );
    }

    return provider;
  }

  async generate(
    config: ImageGenerateTaskConfig,
    references?: Buffer[]
  ): Promise<GeneratedImage> {
    const provider = this.resolveProvider(config);
    const buffer = await provider.generate(config, references);
    return {
      buffer,
      mimeType: 'image/png',
      extension: 'png',
      providerId: provider.descriptor?.id ?? LEGACY_PROVIDER_ID,
      model: provider.model ?? DEFAULT_AI_IMAGE_MODEL,
    };
  }
}
