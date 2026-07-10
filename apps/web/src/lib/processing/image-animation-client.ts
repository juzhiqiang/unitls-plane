// @ts-expect-error -- gifenc ships JavaScript without TypeScript declarations.
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { GifReader } from 'omggif';
import * as UPNG from 'upng-js';

export type AnimationOutputFormat = 'gif' | 'apng';
export type AnimationFitMode = 'contain' | 'cover';
type GifPalette = number[][];

export interface AnimationSourceSize {
  width: number;
  height: number;
}

export interface AnimationFrameLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GifInfo {
  width: number;
  height: number;
  frameCount: number;
}

export interface CompressedGifPlan {
  width: number;
  height: number;
  targetFps: number;
  frameStep: number;
}

export interface AnimationCreateOptions {
  outputFormat: AnimationOutputFormat;
  width: number;
  height: number;
  fit: AnimationFitMode;
  background: string;
  frameDelayMs: number;
  repeat: number;
  quality: number;
  filename: string;
}

export interface AnimationCompressOptions {
  targetWidth: number;
  targetFps: number;
  quality: number;
  filename: string;
}

export interface AnimationPlanLimits {
  maxInputFiles: number;
  maxFileSize: number;
  maxFrames: number;
  maxCanvasPixels: number;
  maxOutputWidth: number;
}

export interface AnimationEntitlements extends AnimationPlanLimits {
  isLoggedIn: boolean;
  isCommercial: boolean;
  canExportGif: boolean;
  canExportApng: boolean;
  canUseAdvancedCompression: boolean;
  canBatchProcess: boolean;
  canSaveHistory: boolean;
}

export const DEFAULT_IMAGE_ANIMATION_LIMITS = {
  free: {
    maxInputFiles: 24,
    maxFileSize: 8 * 1024 * 1024,
    maxFrames: 60,
    maxCanvasPixels: 16_000_000,
    maxOutputWidth: 960,
  },
  commercial: {
    maxInputFiles: 120,
    maxFileSize: 50 * 1024 * 1024,
    maxFrames: 240,
    maxCanvasPixels: 64_000_000,
    maxOutputWidth: 1920,
  },
} satisfies Record<string, AnimationPlanLimits>;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getTransparentPaletteIndex(palette: GifPalette): number {
  const index = palette.findIndex(color => (color[3] ?? 255) <= 127);
  return index >= 0 ? index : 0;
}

function getPaletteColorCount(quality: number): number {
  return clamp(256 - (quality - 1) * 8, 16, 256);
}

function createProcessingCanvas(
  width: number,
  height: number
): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    throw new Error('Animation processing requires a browser environment');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function getCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) {
    throw new Error('Unable to create animation canvas');
  }

  return context;
}

function isTransparentBackground(background: string): boolean {
  return background.trim().toLowerCase() === 'transparent';
}

function encodeGif(
  frames: Array<Uint8Array | Uint8ClampedArray>,
  width: number,
  height: number,
  options: {
    delayMs: number;
    repeat: number;
    quality: number;
    transparent: boolean;
  }
): Uint8Array {
  const gif = GIFEncoder();
  const colorCount = getPaletteColorCount(options.quality);
  const paletteFormat = options.transparent ? 'rgba4444' : 'rgb565';

  for (const frame of frames) {
    const palette = quantize(frame, colorCount, {
      format: paletteFormat,
      oneBitAlpha: options.transparent ? 127 : false,
    });
    const index = applyPalette(frame, palette, paletteFormat);
    const transparentIndex = options.transparent
      ? getTransparentPaletteIndex(palette)
      : undefined;

    gif.writeFrame(index, width, height, {
      palette,
      delay: options.delayMs,
      repeat: options.repeat,
      transparent: options.transparent,
      transparentIndex,
      dispose: options.transparent ? 2 : -1,
    });
  }

  gif.finish();
  return gif.bytes();
}

function getImageDataBuffer(imageData: ImageData): ArrayBuffer {
  return imageData.data.buffer.slice(
    imageData.data.byteOffset,
    imageData.data.byteOffset + imageData.data.byteLength
  );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Unable to load animation frame: ${file.name}`));
    };
    image.src = url;
  });
}

function renderFrameToImageData(
  image: CanvasImageSource,
  source: AnimationSourceSize,
  options: AnimationCreateOptions
): ImageData {
  const normalized = normalizeAnimationCreateOptions(options);
  const canvas = createProcessingCanvas(normalized.width, normalized.height);
  const context = getCanvasContext(canvas);
  const transparent = isTransparentBackground(normalized.background);

  if (transparent) {
    context.clearRect(0, 0, normalized.width, normalized.height);
  } else {
    context.fillStyle = normalized.background;
    context.fillRect(0, 0, normalized.width, normalized.height);
  }

  const layout = buildAnimationFrameLayout(source, normalized);
  context.drawImage(image, layout.x, layout.y, layout.width, layout.height);

  return context.getImageData(0, 0, normalized.width, normalized.height);
}

function scaleRgbaFrame(
  rgba: Uint8Array | Uint8ClampedArray,
  source: AnimationSourceSize,
  target: AnimationSourceSize
): ImageData {
  const sourceCanvas = createProcessingCanvas(source.width, source.height);
  const sourceContext = getCanvasContext(sourceCanvas);
  const targetCanvas = createProcessingCanvas(target.width, target.height);
  const targetContext = getCanvasContext(targetCanvas);

  sourceContext.putImageData(
    new ImageData(new Uint8ClampedArray(rgba), source.width, source.height),
    0,
    0
  );
  targetContext.drawImage(
    sourceCanvas,
    0,
    0,
    source.width,
    source.height,
    0,
    0,
    target.width,
    target.height
  );

  return targetContext.getImageData(0, 0, target.width, target.height);
}

export function getImageAnimationEntitlements(
  session: unknown
): AnimationEntitlements {
  const isLoggedIn = Boolean(session);
  const limits = isLoggedIn
    ? DEFAULT_IMAGE_ANIMATION_LIMITS.commercial
    : DEFAULT_IMAGE_ANIMATION_LIMITS.free;

  return {
    ...limits,
    isLoggedIn,
    isCommercial: isLoggedIn,
    canExportGif: true,
    canExportApng: isLoggedIn,
    canUseAdvancedCompression: isLoggedIn,
    canBatchProcess: isLoggedIn,
    canSaveHistory: isLoggedIn,
  };
}

export function getAnimationOutputName(
  filename: string,
  outputFormat: AnimationOutputFormat
): string {
  const safeBase = filename.trim().replace(/\.[^.]+$/, '');
  const base = safeBase.length > 0 ? safeBase : 'animated-image';
  return `${base}.${outputFormat}`;
}

export function normalizeAnimationCreateOptions(
  options: AnimationCreateOptions
): AnimationCreateOptions {
  return {
    ...options,
    width: Math.max(1, Math.round(options.width)),
    height: Math.max(1, Math.round(options.height)),
    frameDelayMs: clamp(Math.round(options.frameDelayMs), 20, 10_000),
    repeat: Math.max(0, Math.round(options.repeat)),
    quality: clamp(Math.round(options.quality), 1, 30),
  };
}

export function normalizeAnimationCompressOptions(
  options: AnimationCompressOptions
): AnimationCompressOptions {
  return {
    ...options,
    targetWidth: Math.max(1, Math.round(options.targetWidth)),
    targetFps: clamp(Math.round(options.targetFps), 1, 30),
    quality: clamp(Math.round(options.quality), 1, 30),
  };
}

export function buildAnimationFrameLayout(
  source: AnimationSourceSize,
  options: AnimationCreateOptions
): AnimationFrameLayout {
  const normalized = normalizeAnimationCreateOptions(options);
  const sourceWidth = Math.max(1, source.width);
  const sourceHeight = Math.max(1, source.height);
  const widthRatio = normalized.width / sourceWidth;
  const heightRatio = normalized.height / sourceHeight;
  const scale =
    normalized.fit === 'cover'
      ? Math.max(widthRatio, heightRatio)
      : Math.min(widthRatio, heightRatio);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  return {
    x: Math.round((normalized.width - width) / 2),
    y: Math.round((normalized.height - height) / 2),
    width,
    height,
  };
}

export function resolveCompressedGifPlan(
  info: GifInfo,
  options: AnimationCompressOptions,
  limits: AnimationPlanLimits
): CompressedGifPlan {
  const normalized = normalizeAnimationCompressOptions(options);
  const sourceWidth = Math.max(1, Math.round(info.width));
  const sourceHeight = Math.max(1, Math.round(info.height));
  const width = Math.max(
    1,
    Math.min(normalized.targetWidth, limits.maxOutputWidth, sourceWidth)
  );
  const height = Math.max(1, Math.round((sourceHeight * width) / sourceWidth));

  if (width * height > limits.maxCanvasPixels) {
    throw new Error('Canvas is too large for the current plan');
  }

  return {
    width,
    height,
    targetFps: normalized.targetFps,
    frameStep: Math.max(1, Math.ceil(info.frameCount / limits.maxFrames)),
  };
}

export function validateAnimationInputs(
  files: File[],
  options: AnimationCreateOptions,
  limits: AnimationPlanLimits
): void {
  if (files.length < 2) {
    throw new Error('At least two frames are required');
  }
  if (files.length > limits.maxInputFiles || files.length > limits.maxFrames) {
    throw new Error('Too many frames for the current plan');
  }
  if (files.some(file => file.size > limits.maxFileSize)) {
    throw new Error('File is too large for the current plan');
  }
  const normalized = normalizeAnimationCreateOptions(options);
  if (normalized.width * normalized.height > limits.maxCanvasPixels) {
    throw new Error('Canvas is too large for the current plan');
  }
  if (normalized.width > limits.maxOutputWidth) {
    throw new Error('Output width is too large for the current plan');
  }
}

export async function createAnimationFromImages(
  files: File[],
  options: AnimationCreateOptions,
  limits: AnimationPlanLimits
): Promise<File> {
  validateAnimationInputs(files, options, limits);

  const normalized = normalizeAnimationCreateOptions(options);
  const images = await Promise.all(files.map(file => loadImageFromFile(file)));
  const frameData = images.map(image =>
    renderFrameToImageData(
      image,
      { width: image.naturalWidth, height: image.naturalHeight },
      normalized
    )
  );
  const transparent = isTransparentBackground(normalized.background);
  const outputName = getAnimationOutputName(
    normalized.filename,
    normalized.outputFormat
  );

  if (normalized.outputFormat === 'apng') {
    const buffers = frameData.map(getImageDataBuffer);
    const delays = frameData.map(() => normalized.frameDelayMs);
    const encoded = UPNG.encode(
      buffers,
      normalized.width,
      normalized.height,
      getPaletteColorCount(normalized.quality),
      delays
    );

    return new File([encoded], outputName, { type: 'image/apng' });
  }

  const encoded = encodeGif(
    frameData.map(frame => frame.data),
    normalized.width,
    normalized.height,
    {
      delayMs: normalized.frameDelayMs,
      repeat: normalized.repeat,
      quality: normalized.quality,
      transparent,
    }
  );

  return new File([toArrayBuffer(encoded)], outputName, { type: 'image/gif' });
}

export async function compressGif(
  file: File,
  options: AnimationCompressOptions,
  limits: AnimationPlanLimits
): Promise<File> {
  if (file.size > limits.maxFileSize) {
    throw new Error('File is too large for the current plan');
  }

  const normalized = normalizeAnimationCompressOptions(options);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const reader = new GifReader(bytes);
  const info: GifInfo = {
    width: reader.width,
    height: reader.height,
    frameCount: reader.numFrames(),
  };
  const plan = resolveCompressedGifPlan(info, normalized, limits);
  const sourceSize = { width: reader.width, height: reader.height };
  const targetSize = { width: plan.width, height: plan.height };
  const frames: Uint8ClampedArray[] = [];

  for (let index = 0; index < info.frameCount; index += plan.frameStep) {
    const sourceRgba = new Uint8ClampedArray(
      sourceSize.width * sourceSize.height * 4
    );
    reader.decodeAndBlitFrameRGBA(index, sourceRgba);
    frames.push(scaleRgbaFrame(sourceRgba, sourceSize, targetSize).data);
  }

  const encoded = encodeGif(frames, plan.width, plan.height, {
    delayMs: Math.round(1000 / plan.targetFps),
    repeat: 0,
    quality: normalized.quality,
    transparent: false,
  });

  return new File(
    [toArrayBuffer(encoded)],
    getAnimationOutputName(normalized.filename, 'gif'),
    {
      type: 'image/gif',
    }
  );
}
