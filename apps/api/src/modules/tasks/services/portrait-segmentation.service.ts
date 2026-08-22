import { Injectable, Logger, Optional } from '@nestjs/common';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import {
  bufferFromGeneratedImagePayload,
  normalizeOpenAiCompatibleImageEditUrl,
} from './openai-compatible-image';

const MODNET_INPUT_SIZE = 256;
const PORTRAIT_ALPHA_BLACK_POINT = 72;
const PORTRAIT_ALPHA_WHITE_POINT = 144;
const PORTRAIT_ALPHA_GAMMA = 0.55;
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

  const fallbackPath = path.resolve(cwd, 'models/modnet.onnx');
  const candidates = [
    fallbackPath,
    path.resolve(cwd, 'apps/api/models/modnet.onnx'),
  ];

  return candidates.find(candidate => exists(candidate)) ?? fallbackPath;
}

export function createModNetInputTensor(
  rawRgb: Buffer,
  size: number
): Float32Array {
  const tensorData = new Float32Array(1 * 3 * size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const pixel = (y * size + x) * 3;
      const target = y * size + x;
      const r = ((rawRgb[pixel] ?? 0) / 255 - 0.5) / 0.5;
      const g = ((rawRgb[pixel + 1] ?? 0) / 255 - 0.5) / 0.5;
      const b = ((rawRgb[pixel + 2] ?? 0) / 255 - 0.5) / 0.5;

      tensorData[target] = r;
      tensorData[size * size + target] = g;
      tensorData[2 * size * size + target] = b;
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

export function refinePortraitAlphaBytes(alphaBytes: Buffer): Buffer {
  const refined = Buffer.alloc(alphaBytes.length);
  const range = PORTRAIT_ALPHA_WHITE_POINT - PORTRAIT_ALPHA_BLACK_POINT;

  for (let i = 0; i < alphaBytes.length; i += 1) {
    const alpha = alphaBytes[i] ?? 0;
    if (alpha <= PORTRAIT_ALPHA_BLACK_POINT) {
      refined[i] = 0;
      continue;
    }
    if (alpha >= PORTRAIT_ALPHA_WHITE_POINT) {
      refined[i] = 255;
      continue;
    }

    const normalized = (alpha - PORTRAIT_ALPHA_BLACK_POINT) / range;
    refined[i] = Math.round(
      Math.max(0, Math.min(1, normalized ** PORTRAIT_ALPHA_GAMMA)) * 255
    );
  }

  return refined;
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
    const alphaBytes = refinePortraitAlphaBytes(
      await this.inferAlphaBytes(session, orientedInput)
    );
    if (!alphaBytes.length) {
      return { mask: Buffer.alloc(0), faceCount: 0 };
    }

    const mask = await sharp(alphaBytes, {
      raw: {
        width: MODNET_INPUT_SIZE,
        height: MODNET_INPUT_SIZE,
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
    input: Buffer
  ): Promise<Buffer> {
    const raw = await sharp(input)
      .resize(MODNET_INPUT_SIZE, MODNET_INPUT_SIZE, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer();
    const tensorData = createModNetInputTensor(raw, MODNET_INPUT_SIZE);
    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    if (!inputName || !outputName) {
      return Buffer.alloc(0);
    }

    const result = await session.run({
      [inputName]: new ort.Tensor('float32', tensorData, [
        1,
        3,
        MODNET_INPUT_SIZE,
        MODNET_INPUT_SIZE,
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
      this.sessionPromise = ort.InferenceSession.create(modelPath);
    }
    return this.sessionPromise;
  }
}
