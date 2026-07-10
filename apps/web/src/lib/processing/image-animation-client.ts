export type AnimationOutputFormat = 'gif' | 'apng';
export type AnimationFitMode = 'contain' | 'cover';

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
