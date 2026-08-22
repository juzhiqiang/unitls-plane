import { Injectable, Logger, Optional } from '@nestjs/common';
import type {
  ImageGenerateStyle,
  ImageGenerateTaskConfig,
} from '@utils-plane/validators';
import { ErrorCodes } from '../../../common/errors/error-codes';
import {
  bufferFromGeneratedImagePayload,
  normalizeOpenAiCompatibleImageGenerationUrl,
} from './openai-compatible-image';

/** provider 与生成标识共用同一个默认模型,避免 EXIF 记的模型与实际请求不一致。 */
export const DEFAULT_AI_IMAGE_MODEL = 'gpt-image-1';

/** 模型解析收在一处:用 || 而不是 ?? ,env "设了但为空" 也要回退默认值。 */
export function resolveAiImageModel(): string {
  return process.env.AI_IMAGE_MODEL || DEFAULT_AI_IMAGE_MODEL;
}

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

export class ImageGenerationError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ImageGenerationError';
  }
}

export interface ImageGenerationProvider {
  generate(config: ImageGenerateTaskConfig): Promise<Buffer>;
}

export interface OpenAiCompatibleImageGenerationProviderOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  responseFormat?: string;
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
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly responseFormat: string;
  private readonly fetchImpl: typeof fetch;

  constructor({
    baseUrl = process.env.AI_IMAGE_BASE_URL,
    apiKey = process.env.AI_IMAGE_API_KEY,
    model = resolveAiImageModel(),
    responseFormat = process.env.AI_IMAGE_RESPONSE_FORMAT || 'b64_json',
    fetch: fetchImpl = fetch,
  }: OpenAiCompatibleImageGenerationProviderOptions = {}) {
    if (!baseUrl) {
      throw new Error('AI_IMAGE_BASE_URL is not configured');
    }
    this.generationUrl = normalizeOpenAiCompatibleImageGenerationUrl(baseUrl);
    this.apiKey = apiKey;
    this.model = model;
    this.responseFormat = responseFormat;
    this.fetchImpl = fetchImpl;
  }

  async generate(config: ImageGenerateTaskConfig): Promise<Buffer> {
    const response = await this.fetchImpl(this.generationUrl, {
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
      }),
    });

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
      throw new ImageGenerationError(
        ErrorCodes.AI_IMAGE_GENERATION_FAILED,
        'Image generation failed'
      );
    }
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
      `AI image generation upstream failed: status=${status} body=${body.slice(0, 2000)}`
    );

    const lowered = body.toLowerCase();
    const rejected = CONTENT_REJECTION_MARKERS.some(marker =>
      lowered.includes(marker)
    );

    return rejected
      ? new ImageGenerationError(
          ErrorCodes.AI_IMAGE_CONTENT_REJECTED,
          'The prompt was rejected by the provider content policy'
        )
      : new ImageGenerationError(
          ErrorCodes.AI_IMAGE_GENERATION_FAILED,
          'Image generation failed'
        );
  }
}

export interface ImageGenerationServiceOptions {
  externalProvider?: ImageGenerationProvider | null;
}

export interface GeneratedImage {
  buffer: Buffer;
  mimeType: string;
  extension: string;
}

@Injectable()
export class ImageGenerationService {
  private readonly logger = new Logger(ImageGenerationService.name);
  private readonly provider: ImageGenerationProvider | null;

  constructor(@Optional() options?: ImageGenerationServiceOptions) {
    if (options && 'externalProvider' in options) {
      this.provider = options.externalProvider ?? null;
    } else if (process.env.AI_IMAGE_BASE_URL) {
      this.provider = new OpenAiCompatibleImageGenerationProvider();
    } else {
      this.provider = null;
      this.logger.log(
        'AI_IMAGE_BASE_URL is not set; image generation stays disabled'
      );
    }
  }

  get configured(): boolean {
    return this.provider !== null;
  }

  async generate(config: ImageGenerateTaskConfig): Promise<GeneratedImage> {
    if (!this.provider) {
      throw new ImageGenerationError(
        ErrorCodes.AI_IMAGE_NOT_CONFIGURED,
        'AI image generation is not configured'
      );
    }

    const buffer = await this.provider.generate(config);
    return { buffer, mimeType: 'image/png', extension: 'png' };
  }
}
