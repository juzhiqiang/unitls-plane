// prettier-ignore
// @ts-expect-error TS7016 -- gifenc ships JavaScript without TypeScript declarations.
import { GIFEncoder as createUntypedGifEncoder, applyPalette as applyUntypedPalette, quantize as quantizeUntyped } from 'gifenc';
import { GifReader } from 'omggif';
import * as UPNG from 'upng-js';

export type AnimationOutputFormat = 'gif' | 'apng';
export type AnimationFitMode = 'contain' | 'cover';
type GifPalette = number[][];
type GifPaletteFormat = 'rgba4444' | 'rgb565';
type GifFrameBuffer = Uint8Array | Uint8ClampedArray;
type GifFrameInfo = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  delay?: number;
  disposal?: number;
};
type GifEncoder = {
  writeFrame(
    index: Uint8Array,
    width: number,
    height: number,
    options: {
      palette: GifPalette;
      delay: number;
      repeat: number;
      dispose: number;
      transparent?: boolean;
      transparentIndex?: number;
    }
  ): void;
  finish(): void;
  bytes(): Uint8Array;
};

const GIFEncoder = createUntypedGifEncoder as () => GifEncoder;
const applyPalette = applyUntypedPalette as (
  frame: GifFrameBuffer,
  palette: GifPalette,
  format: GifPaletteFormat
) => Uint8Array;
const quantize = quantizeUntyped as (
  frame: GifFrameBuffer,
  colorCount: number,
  options: { format: GifPaletteFormat; oneBitAlpha: number | false }
) => GifPalette;

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
  maxTotalFramePixels: number;
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
    maxTotalFramePixels: 120_000_000,
    maxOutputWidth: 960,
  },
  commercial: {
    maxInputFiles: 120,
    maxFileSize: 50 * 1024 * 1024,
    maxFrames: 240,
    maxCanvasPixels: 64_000_000,
    maxTotalFramePixels: 480_000_000,
    maxOutputWidth: 1920,
  },
} satisfies Record<string, AnimationPlanLimits>;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function findTransparentPaletteIndex(
  palette: GifPalette
): number | undefined {
  const index = palette.findIndex(color => (color[3] ?? 255) <= 127);
  return index >= 0 ? index : undefined;
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

function createGifWriter(
  width: number,
  height: number,
  options: {
    repeat: number;
    quality: number;
    transparent: boolean;
  }
) {
  const gif = GIFEncoder();
  const colorCount = getPaletteColorCount(options.quality);
  const paletteFormat = options.transparent ? 'rgba4444' : 'rgb565';

  return {
    writeFrame(frame: GifFrameBuffer, delayMs: number): void {
      const palette = quantize(frame, colorCount, {
        format: paletteFormat,
        oneBitAlpha: options.transparent ? 127 : false,
      });
      const index = applyPalette(frame, palette, paletteFormat);
      const transparentIndex = options.transparent
        ? findTransparentPaletteIndex(palette)
        : undefined;
      const frameOptions: Parameters<GifEncoder['writeFrame']>[3] = {
        palette,
        delay: delayMs,
        repeat: options.repeat,
        dispose: options.transparent ? 2 : -1,
      };

      if (transparentIndex !== undefined) {
        frameOptions.transparent = true;
        frameOptions.transparentIndex = transparentIndex;
      }

      gif.writeFrame(index, width, height, frameOptions);
    },
    finish(): Uint8Array {
      gif.finish();
      return gif.bytes();
    },
  };
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

export function validateAnimationFrameBudget(
  frameCount: number,
  outputFormat: AnimationOutputFormat,
  limits: AnimationPlanLimits,
  framePixels = limits.maxCanvasPixels
): void {
  if (outputFormat !== 'apng') {
    return;
  }

  const totalFramePixels = Math.max(0, frameCount) * Math.max(0, framePixels);

  if (totalFramePixels > limits.maxTotalFramePixels) {
    throw new Error(
      'Animation has too many total frame pixels for the current plan'
    );
  }
}

function getGifFrameDelayMs(
  frameInfo: GifFrameInfo | undefined,
  fallbackDelayMs: number
): number {
  const delayCentiseconds = frameInfo?.delay;

  if (
    typeof delayCentiseconds === 'number' &&
    Number.isFinite(delayCentiseconds) &&
    delayCentiseconds > 0
  ) {
    return Math.round(delayCentiseconds * 10);
  }

  return fallbackDelayMs;
}

export function getCompressedGifFrameDelayMs(
  frameInfos: GifFrameInfo[],
  startIndex: number,
  frameStep: number,
  targetFps: number
): number {
  const fallbackDelayMs = Math.round(
    1000 / clamp(Math.round(targetFps), 1, 30)
  );
  const safeStart = clamp(Math.round(startIndex), 0, frameInfos.length);
  const safeStep = Math.max(1, Math.round(frameStep));
  const endIndex = Math.min(frameInfos.length, safeStart + safeStep);
  let delayMs = 0;

  for (let index = safeStart; index < endIndex; index += 1) {
    delayMs += getGifFrameDelayMs(frameInfos[index], fallbackDelayMs);
  }

  return Math.max(delayMs, fallbackDelayMs);
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
  validateAnimationFrameBudget(
    files.length,
    normalized.outputFormat,
    limits,
    normalized.width * normalized.height
  );
}

function clearRgbaRect(
  buffer: Uint8ClampedArray,
  screenWidth: number,
  screenHeight: number,
  rect: Required<Pick<GifFrameInfo, 'x' | 'y' | 'width' | 'height'>>
): void {
  const left = clamp(Math.round(rect.x), 0, screenWidth);
  const top = clamp(Math.round(rect.y), 0, screenHeight);
  const right = clamp(Math.round(rect.x + rect.width), left, screenWidth);
  const bottom = clamp(Math.round(rect.y + rect.height), top, screenHeight);

  for (let y = top; y < bottom; y += 1) {
    const rowStart = (y * screenWidth + left) * 4;
    buffer.fill(0, rowStart, rowStart + (right - left) * 4);
  }
}

function getGifFrameRect(
  frameInfo: GifFrameInfo,
  screen: AnimationSourceSize
): Required<Pick<GifFrameInfo, 'x' | 'y' | 'width' | 'height'>> {
  return {
    x: frameInfo.x ?? 0,
    y: frameInfo.y ?? 0,
    width: frameInfo.width ?? screen.width,
    height: frameInfo.height ?? screen.height,
  };
}

function applyPreviousGifDisposal(
  screenRgba: Uint8ClampedArray,
  screen: AnimationSourceSize,
  previousFrameInfo: GifFrameInfo | undefined,
  restoreBuffer: Uint8ClampedArray | undefined
): void {
  if (!previousFrameInfo) {
    return;
  }

  if (previousFrameInfo.disposal === 2) {
    clearRgbaRect(
      screenRgba,
      screen.width,
      screen.height,
      getGifFrameRect(previousFrameInfo, screen)
    );
    return;
  }

  if (previousFrameInfo.disposal === 3 && restoreBuffer) {
    screenRgba.set(restoreBuffer);
  }
}

export async function createAnimationFromImages(
  files: File[],
  options: AnimationCreateOptions,
  limits: AnimationPlanLimits
): Promise<File> {
  validateAnimationInputs(files, options, limits);

  const normalized = normalizeAnimationCreateOptions(options);
  const transparent = isTransparentBackground(normalized.background);
  const outputName = getAnimationOutputName(
    normalized.filename,
    normalized.outputFormat
  );

  if (normalized.outputFormat === 'apng') {
    const buffers: ArrayBuffer[] = [];
    const delays: number[] = [];

    for (const file of files) {
      const image = await loadImageFromFile(file);
      const frameData = renderFrameToImageData(
        image,
        { width: image.naturalWidth, height: image.naturalHeight },
        normalized
      );

      buffers.push(getImageDataBuffer(frameData));
      delays.push(normalized.frameDelayMs);
    }

    // UPNG.encode accepts frame delays here, but the upng-js API does not expose
    // a loop-count parameter, so normalized.repeat cannot be represented.
    const encoded = UPNG.encode(
      buffers,
      normalized.width,
      normalized.height,
      getPaletteColorCount(normalized.quality),
      delays
    );

    return new File([encoded], outputName, { type: 'image/apng' });
  }

  const gif = createGifWriter(normalized.width, normalized.height, {
    repeat: normalized.repeat,
    quality: normalized.quality,
    transparent,
  });

  for (const file of files) {
    const image = await loadImageFromFile(file);
    const frameData = renderFrameToImageData(
      image,
      { width: image.naturalWidth, height: image.naturalHeight },
      normalized
    );

    gif.writeFrame(frameData.data, normalized.frameDelayMs);
  }

  const encoded = gif.finish();

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
  const sourceRgba = new Uint8ClampedArray(
    sourceSize.width * sourceSize.height * 4
  );
  const frameInfos = Array.from(
    { length: info.frameCount },
    (_, index) => reader.frameInfo(index) as GifFrameInfo
  );
  const minOutputDelayMs = Math.round(1000 / plan.targetFps);
  const gif = createGifWriter(plan.width, plan.height, {
    repeat: 0,
    quality: normalized.quality,
    transparent: false,
  });
  let previousFrameInfo: GifFrameInfo | undefined;
  let previousRestoreBuffer: Uint8ClampedArray | undefined;
  let pendingFrame: Uint8ClampedArray | undefined;
  let pendingFrameIndex = -1;
  let pendingDelayMs = 0;

  for (let index = 0; index < info.frameCount; index += 1) {
    applyPreviousGifDisposal(
      sourceRgba,
      sourceSize,
      previousFrameInfo,
      previousRestoreBuffer
    );

    const frameInfo = frameInfos[index] ?? {};
    const restoreBuffer =
      frameInfo.disposal === 3 ? new Uint8ClampedArray(sourceRgba) : undefined;

    reader.decodeAndBlitFrameRGBA(index, sourceRgba);

    const shouldStartOutputFrame =
      !pendingFrame ||
      (pendingDelayMs >= minOutputDelayMs &&
        index - pendingFrameIndex >= plan.frameStep);

    if (shouldStartOutputFrame) {
      if (pendingFrame) {
        gif.writeFrame(
          pendingFrame,
          Math.max(pendingDelayMs, minOutputDelayMs)
        );
      }

      pendingFrame = scaleRgbaFrame(sourceRgba, sourceSize, targetSize).data;
      pendingFrameIndex = index;
      pendingDelayMs = 0;
    }

    pendingDelayMs += getGifFrameDelayMs(frameInfo, minOutputDelayMs);
    previousFrameInfo = frameInfo;
    previousRestoreBuffer = restoreBuffer;
  }

  if (pendingFrame) {
    gif.writeFrame(pendingFrame, Math.max(pendingDelayMs, minOutputDelayMs));
  }

  const encoded = gif.finish();

  return new File(
    [toArrayBuffer(encoded)],
    getAnimationOutputName(normalized.filename, 'gif'),
    {
      type: 'image/gif',
    }
  );
}
