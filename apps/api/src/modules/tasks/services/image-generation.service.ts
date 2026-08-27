import { Injectable, Logger, Optional } from '@nestjs/common';
import type {
  ImageGenerateStyle,
  ImageGenerateTaskConfig,
} from '@utils-plane/validators';
import sharp from 'sharp';
import { ErrorCodes } from '../../../common/errors/error-codes';
import {
  DEFAULT_AI_IMAGE_MODEL,
  LEGACY_PROVIDER_ID,
  loadImageProviderConfigs,
  resolveAiImageModel,
  resolveAiImageRequestTimeoutMs,
  type ImageProviderCapability,
  type ImageProviderConfig,
  type ImageProviderEditTransport,
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

/** 下发给前端的来源信息。只有这三个字段可以出网:baseUrl 与 apiKey 永不外泄。 */
export interface ImageProviderDescriptor {
  id: string;
  label: string;
  capabilities: ImageProviderCapability[];
}

export interface ImageGenerationProvider {
  /** reference 只在 image_to_image 下有意义:文生图传了也会被忽略。 */
  generate(
    config: ImageGenerateTaskConfig,
    reference?: Buffer
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
  editTransport?: ImageProviderEditTransport;
  refImagesField?: string;
  refImageEncoding?: ImageProviderRefEncoding;
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
    editTransport = 'multipart',
    refImagesField = 'reference_images',
    refImageEncoding = 'data_url',
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
    this.descriptor = { id, label: label ?? id, capabilities };
    this.responseFormat = responseFormat;
    this.editTransport = editTransport;
    this.refImagesField = refImagesField;
    this.refImageEncoding = refImageEncoding;
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
    reference?: Buffer
  ): Promise<Buffer> {
    let response: Response;
    try {
      response =
        config.mode === 'image_to_image'
          ? await this.postEdit(config, reference)
          : await this.postGeneration(config);
    } catch (error) {
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

  private async postGeneration(
    config: ImageGenerateTaskConfig,
    extraBody: Record<string, unknown> = {}
  ): Promise<Response> {
    return this.fetchWithTimeout(this.generationUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        prompt: buildImageGenerationPrompt(config),
        size: config.size,
        quality: config.quality,
        response_format: this.responseFormat,
        n: 1,
        ...extraBody,
      }),
    });
  }

  /**
   * 图生图。端点与传图方式按来源配置分支;文生图则所有来源共用 /v1/images/generations。
   *
   * 参考图先过 sharp:统一转 PNG(上游只认少数格式)、按 EXIF 方向摆正,
   * 并顺带丢掉原图元数据(sharp 默认不透传),不把用户照片里的 GPS 发给 provider。
   */
  private async postEdit(
    config: ImageGenerateTaskConfig,
    reference?: Buffer
  ): Promise<Response> {
    if (!reference?.length) {
      this.logger.warn(
        'AI image edit requested without a reference image; refusing to call upstream'
      );
      throw new ImageGenerationError(
        ErrorCodes.AI_IMAGE_GENERATION_FAILED,
        'Image generation failed'
      );
    }

    const normalized = await sharp(reference).rotate().png().toBuffer();

    // kmage 一类网关没有 /v1/images/edits:图生图也走 generations,参考图放进 JSON 数组。
    if (this.editTransport === 'generations_ref') {
      const base64 = normalized.toString('base64');
      const encoded =
        this.refImageEncoding === 'base64'
          ? base64
          : `data:image/png;base64,${base64}`;
      return this.postGeneration(config, { [this.refImagesField]: [encoded] });
    }

    // 不要手写 Content-Type:multipart 的 boundary 只有 FormData 自己知道。
    const form = new FormData();
    form.set('model', this.model);
    form.set(
      'image',
      new Blob([new Uint8Array(normalized)], { type: 'image/png' }),
      'source.png'
    );
    form.set('prompt', buildImageGenerationPrompt(config));
    form.set('size', config.size);
    form.set('quality', config.quality);
    form.set('response_format', this.responseFormat);
    form.set('n', '1');

    return this.fetchWithTimeout(this.editUrl, {
      method: 'POST',
      headers: {
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: form,
    });
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
  inpaint: 'edit',
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

    return provider;
  }

  async generate(
    config: ImageGenerateTaskConfig,
    reference?: Buffer
  ): Promise<GeneratedImage> {
    const provider = this.resolveProvider(config);
    const buffer = await provider.generate(config, reference);
    return {
      buffer,
      mimeType: 'image/png',
      extension: 'png',
      providerId: provider.descriptor?.id ?? LEGACY_PROVIDER_ID,
      model: provider.model ?? DEFAULT_AI_IMAGE_MODEL,
    };
  }
}
