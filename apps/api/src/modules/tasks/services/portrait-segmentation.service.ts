import { Injectable, Logger, Optional } from '@nestjs/common';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import {
  MODNET_LONG_EDGE,
  modnetInputSize,
  refinePortraitAlphaBytes,
} from '@utils-plane/utils';
import {
  bufferFromGeneratedImagePayload,
  normalizeOpenAiCompatibleImageEditUrl,
} from './openai-compatible-image';

export { modnetInputSize, refinePortraitAlphaBytes };
export const MODNET_INPUT_SIZE = MODNET_LONG_EDGE;

const MODNET_PHOTOGRAPHIC_NAME = 'modnet_photographic.onnx';
const MODNET_GENERIC_NAME = 'modnet.onnx';
const DEFAULT_OPENAI_SEGMENTATION_MODEL = 'gpt-4o-mini';
const DEFAULT_OPENAI_SEGMENTATION_PROVIDER = 'chat_mask';

export type PortraitMask = {
  mask: Buffer;
  bounds?: { x: number; y: number; width: number; height: number };
  faceCount?: number;
};

export type PortraitSegmentationMode = 'local' | 'ai';

export type PortraitSegmentationOptions = {
  mode?: PortraitSegmentationMode;
};

export type AiIdPhotoRenderOptions = {
  width: number;
  height: number;
  backgroundColor: string;
  outputType: 'image/jpeg' | 'image/png';
};

export type PortraitAiProviderMode = 'chat_mask' | 'image_result';

type PortraitAiProvider = {
  segment?: (input: Buffer) => Promise<PortraitMask>;
  renderIdPhoto?: (
    input: Buffer,
    options: AiIdPhotoRenderOptions,
    mask?: Buffer
  ) => Promise<Buffer>;
};

type ResolveModelPathOptions = {
  configuredPath?: string;
  cwd?: string;
  exists?: (modelPath: string) => boolean;
};

type OpenAiCompatiblePortraitSegmentationProviderOptions = {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  provider?: PortraitAiProviderMode;
  fetch?: typeof fetch;
};

type PortraitSegmentationServiceOptions = {
  externalProvider?: PortraitAiProvider;
};

export function resolvePortraitSegmentationModelPath({
  configuredPath = process.env.ID_PHOTO_SEGMENTATION_MODEL,
  cwd = process.cwd(),
  exists = existsSync,
}: ResolveModelPathOptions = {}): string {
  if (configuredPath) {
    return configuredPath;
  }

  // photographic 优先：它是证件照专用变体，通用 modnet 只作文件缺失时的回落。
  // 注意：Task 1 实测两者逐像素等价（max abs diff = 0），回落的意义仅在
  // 「photographic 文件缺失时不至于整条链路不可用」，不带来画质差异。
  //
  // 候选顺序与 resolveYunetModelPath 保持一致：
  //   env 覆盖 → 仓库内 apps/api/models → 仓库根 docker/models → 镜像内置 models/id-photo。
  // 组合镜像把 docker/models/ 复制到 /app/models/id-photo/（见根 Dockerfile），
  // 所以容器内 cwd=/app 时 photographic 实际位于 models/id-photo/modnet/；
  // 仓库本地开发时它位于 docker/models/modnet/。
  const candidates = [
    path.resolve(cwd, `apps/api/models/${MODNET_PHOTOGRAPHIC_NAME}`),
    path.resolve(cwd, `models/modnet/${MODNET_PHOTOGRAPHIC_NAME}`),
    path.resolve(cwd, `models/id-photo/modnet/${MODNET_PHOTOGRAPHIC_NAME}`),
    path.resolve(cwd, `docker/models/modnet/${MODNET_PHOTOGRAPHIC_NAME}`),
    path.resolve(cwd, `models/${MODNET_PHOTOGRAPHIC_NAME}`),
    path.resolve(cwd, `apps/api/models/${MODNET_GENERIC_NAME}`),
    path.resolve(cwd, `models/modnet/${MODNET_GENERIC_NAME}`),
    path.resolve(cwd, `models/id-photo/modnet/${MODNET_GENERIC_NAME}`),
    path.resolve(cwd, `docker/models/modnet/${MODNET_GENERIC_NAME}`),
    path.resolve(cwd, `models/${MODNET_GENERIC_NAME}`),
  ];
  return candidates.find(candidate => exists(candidate)) ?? candidates[0]!;
}

function resolveGenericModNetModelPath(
  cwd: string = process.cwd(),
  exists: (modelPath: string) => boolean = existsSync
): string {
  const candidates = [
    path.resolve(cwd, `apps/api/models/${MODNET_GENERIC_NAME}`),
    path.resolve(cwd, `models/modnet/${MODNET_GENERIC_NAME}`),
    path.resolve(cwd, `models/id-photo/modnet/${MODNET_GENERIC_NAME}`),
    path.resolve(cwd, `docker/models/modnet/${MODNET_GENERIC_NAME}`),
    path.resolve(cwd, `models/${MODNET_GENERIC_NAME}`),
  ];
  return candidates.find(candidate => exists(candidate)) ?? candidates[1]!;
}

export function createModNetInputTensor(
  rawRgb: Buffer,
  width: number,
  height: number
): Float32Array {
  const plane = width * height;
  const tensorData = new Float32Array(3 * plane);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = (y * width + x) * 3;
      const target = y * width + x;
      const r = ((rawRgb[pixel] ?? 0) / 255 - 0.5) / 0.5;
      const g = ((rawRgb[pixel + 1] ?? 0) / 255 - 0.5) / 0.5;
      const b = ((rawRgb[pixel + 2] ?? 0) / 255 - 0.5) / 0.5;

      tensorData[target] = r;
      tensorData[plane + target] = g;
      tensorData[2 * plane + target] = b;
    }
  }
  return tensorData;
}

export function normalizeModNetMatteValues(
  matteValues: ArrayLike<number>
): Buffer {
  const maskBytes = Buffer.alloc(matteValues.length);
  for (let i = 0; i < maskBytes.length; i += 1) {
    const normalized = matteValues[i] ?? 0;
    maskBytes[i] = Math.max(0, Math.min(255, Math.round(normalized * 255)));
  }
  return maskBytes;
}

function normalizeOpenAiCompatibleBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed;
  }
  if (trimmed.endsWith('/v1')) {
    return `${trimmed}/chat/completions`;
  }
  return `${trimmed}/v1/chat/completions`;
}

function stripJsonFence(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

function parseMaskReferenceFromOpenAiContent(content: string): string {
  const parsed = JSON.parse(stripJsonFence(content)) as Record<string, unknown>;
  const mask =
    parsed.mask ?? parsed.alphaMask ?? parsed.image ?? parsed.maskDataUrl;
  if (typeof mask !== 'string' || !mask.trim()) {
    throw new Error('OpenAI-compatible segmentation response missing mask');
  }
  return mask.trim();
}

async function bufferFromMaskReference(
  maskReference: string,
  fetchImpl: typeof fetch
): Promise<Buffer> {
  if (maskReference.startsWith('data:')) {
    const [, payload] = maskReference.split(',', 2);
    if (!payload) {
      throw new Error('Invalid mask data URL');
    }
    return Buffer.from(payload, 'base64');
  }

  if (/^https?:\/\//i.test(maskReference)) {
    const response = await fetchImpl(maskReference);
    if (!response.ok) {
      throw new Error(
        `Failed to download segmentation mask: ${response.status}`
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }

  return Buffer.from(maskReference, 'base64');
}

export class OpenAiCompatiblePortraitSegmentationProvider implements PortraitAiProvider {
  private readonly chatUrl: string;
  private readonly imageEditUrl: string;
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly provider: PortraitAiProviderMode;
  private readonly fetchImpl: typeof fetch;

  constructor({
    baseUrl = process.env.ID_PHOTO_AI_SEGMENTATION_BASE_URL,
    apiKey = process.env.ID_PHOTO_AI_SEGMENTATION_API_KEY,
    model = process.env.ID_PHOTO_AI_SEGMENTATION_MODEL ??
      DEFAULT_OPENAI_SEGMENTATION_MODEL,
    provider = (process.env.ID_PHOTO_AI_SEGMENTATION_PROVIDER as
      | PortraitAiProviderMode
      | undefined) ?? DEFAULT_OPENAI_SEGMENTATION_PROVIDER,
    fetch: fetchImpl = fetch,
  }: OpenAiCompatiblePortraitSegmentationProviderOptions = {}) {
    if (!baseUrl) {
      throw new Error('ID_PHOTO_AI_SEGMENTATION_BASE_URL is not configured');
    }
    this.chatUrl = normalizeOpenAiCompatibleBaseUrl(baseUrl);
    this.imageEditUrl = normalizeOpenAiCompatibleImageEditUrl(baseUrl);
    this.apiKey = apiKey;
    this.model = model;
    this.provider = provider === 'image_result' ? provider : 'chat_mask';
    this.fetchImpl = fetchImpl;
  }

  async segment(input: Buffer): Promise<PortraitMask> {
    if (this.provider === 'image_result') {
      throw new Error('image_result provider does not return a mask');
    }

    const orientedInput = await sharp(input).rotate().png().toBuffer();
    const response = await this.fetchImpl(this.chatUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You return only JSON. Segment the person in the image and return {"mask":"data:image/png;base64,..."} where the mask is a single-channel or alpha PNG: white is person, black is background.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Create a portrait alpha mask for this ID photo input.',
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/png;base64,${orientedInput.toString(
                    'base64'
                  )}`,
                },
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(
        `OpenAI-compatible segmentation failed: ${response.status}`
      );
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(
        'OpenAI-compatible segmentation response missing content'
      );
    }

    const maskReference = parseMaskReferenceFromOpenAiContent(content);
    const maskBuffer = await bufferFromMaskReference(
      maskReference,
      this.fetchImpl
    );
    const metadata = await sharp(orientedInput).metadata();
    if (!metadata.width || !metadata.height) {
      return { mask: Buffer.alloc(0), faceCount: 0 };
    }

    const mask = await sharp(maskBuffer)
      .resize(metadata.width, metadata.height, { fit: 'fill' })
      .greyscale()
      .png()
      .toBuffer();

    return {
      mask,
      bounds: { x: 0, y: 0, width: metadata.width, height: metadata.height },
      faceCount: 1,
    };
  }

  async renderIdPhoto(
    input: Buffer,
    options: AiIdPhotoRenderOptions,
    mask?: Buffer
  ): Promise<Buffer> {
    if (this.provider !== 'image_result') {
      throw new Error('chat_mask provider does not return a final image');
    }
    void mask;

    const orientedInput = await sharp(input).rotate().png().toBuffer();
    const metadata = await sharp(orientedInput).metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error('AI image edit input is not a valid image');
    }
    const prompt = [
      'Use the uploaded image as the reference portrait.',
      `Use a solid ${options.backgroundColor} background.`,
      'Keep the original person, face, hair, hat, clothing, and outline unchanged.',
      'Remove white edge halos around the person.',
      'Return a clean formal ID photo with an opaque background.',
    ].join(' ');
    const form = new FormData();
    form.set('model', this.model);
    form.set(
      'image',
      new Blob([orientedInput], { type: 'image/png' }),
      'portrait.png'
    );
    form.set('prompt', prompt);
    form.set('size', process.env.ID_PHOTO_AI_IMAGE_SIZE ?? '1024x1024');
    form.set('quality', process.env.ID_PHOTO_AI_IMAGE_QUALITY ?? 'high');
    form.set(
      'background',
      process.env.ID_PHOTO_AI_IMAGE_BACKGROUND ?? 'opaque'
    );
    form.set(
      'response_format',
      process.env.ID_PHOTO_AI_RESPONSE_FORMAT ?? 'url'
    );

    const response = await this.fetchImpl(this.imageEditUrl, {
      method: 'POST',
      headers: {
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: form,
    });

    if (!response.ok) {
      let message = `OpenAI-compatible image result failed: ${response.status}`;
      try {
        const payload = (await response.json()) as {
          error?: { message?: string; code?: string };
        };
        if (payload.error?.message) {
          message = `${message} ${payload.error.message}`;
        }
      } catch {
        // Keep the status-only message when upstream does not return JSON.
      }
      throw new Error(message);
    }

    return bufferFromGeneratedImagePayload(
      await response.json(),
      this.fetchImpl
    );
  }
}

@Injectable()
export class PortraitSegmentationService {
  private readonly logger = new Logger(PortraitSegmentationService.name);
  private sessionPromise?: Promise<ort.InferenceSession>;
  private readonly externalProvider?: PortraitAiProvider;

  constructor(@Optional() options?: PortraitSegmentationServiceOptions) {
    this.externalProvider =
      options?.externalProvider ??
      (process.env.ID_PHOTO_AI_SEGMENTATION_BASE_URL
        ? new OpenAiCompatiblePortraitSegmentationProvider()
        : undefined);
  }

  async segment(
    input: Buffer,
    options: PortraitSegmentationOptions = {}
  ): Promise<PortraitMask> {
    if (options.mode === 'ai' && this.externalProvider?.segment) {
      try {
        return await this.externalProvider.segment(input);
      } catch {
        // Fall back to the local model so AI mode still produces a result.
      }
    }

    const orientedInput = await sharp(input).rotate().toBuffer();
    const metadata = await sharp(orientedInput).metadata();
    if (!metadata.width || !metadata.height) {
      return { mask: Buffer.alloc(0), faceCount: 0 };
    }

    const session = await this.getSession();
    const sourceSize = { width: metadata.width, height: metadata.height };
    const alphaBytes = refinePortraitAlphaBytes(
      await this.inferAlphaBytes(session, orientedInput, sourceSize)
    );
    if (!alphaBytes.length) {
      return { mask: Buffer.alloc(0), faceCount: 0 };
    }

    // 输入没有补边，蒙版就是整张图的前景概率，直接缩放回原尺寸
    const box = modnetInputSize(sourceSize, MODNET_INPUT_SIZE);
    const mask = await sharp(alphaBytes, {
      raw: {
        width: box.width,
        height: box.height,
        channels: 1,
      },
    })
      .resize(metadata.width, metadata.height, { fit: 'fill' })
      .png()
      .toBuffer();

    return {
      mask,
      bounds: { x: 0, y: 0, width: metadata.width, height: metadata.height },
      faceCount: 1,
    };
  }

  async renderIdPhoto(
    input: Buffer,
    options: AiIdPhotoRenderOptions
  ): Promise<Buffer | undefined> {
    if (!this.externalProvider?.renderIdPhoto) {
      return undefined;
    }

    try {
      return await this.externalProvider.renderIdPhoto(input, options);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown AI render error';
      this.logger.warn(`AI image result render failed: ${message}`);
      throw error;
    }
  }

  private async inferAlphaBytes(
    session: ort.InferenceSession,
    input: Buffer,
    sourceSize: { width: number; height: number }
  ): Promise<Buffer> {
    const box = modnetInputSize(sourceSize, MODNET_INPUT_SIZE);
    // 宽高比已保持，fit:'fill' 不会产生形变；这里不 extend 补边
    const raw = await sharp(input)
      .resize(box.width, box.height, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer();
    const tensorData = createModNetInputTensor(raw, box.width, box.height);
    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    if (!inputName || !outputName) {
      return Buffer.alloc(0);
    }

    const result = await session.run({
      [inputName]: new ort.Tensor('float32', tensorData, [
        1,
        3,
        box.height,
        box.width,
      ]),
    });
    const output = result[outputName];
    if (!output) {
      return Buffer.alloc(0);
    }

    return normalizeModNetMatteValues(output.data as Float32Array);
  }

  private getSession(): Promise<ort.InferenceSession> {
    if (!this.sessionPromise) {
      const modelPath = resolvePortraitSegmentationModelPath();
      const sessionPromise = ort.InferenceSession.create(modelPath).catch(
        err => {
          // photographic 缺失时退回通用 modnet，保证任务仍能产出
          const genericPath = resolveGenericModNetModelPath();
          if (modelPath === genericPath) {
            throw err;
          }
          this.logger.warn(
            `falling back to generic modnet (${modelPath} unavailable): ${
              err instanceof Error ? err.message : String(err)
            }`
          );
          return ort.InferenceSession.create(genericPath);
        }
      );
      // 被拒绝的 promise 不能缓存，否则一次模型加载失败会让后续任务永远失败。
      this.sessionPromise = sessionPromise.catch(err => {
        this.sessionPromise = undefined;
        throw err;
      });
    }
    return this.sessionPromise;
  }
}
