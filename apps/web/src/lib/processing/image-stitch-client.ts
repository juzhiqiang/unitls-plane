import { canUseFeature, getLimit } from '@utils-plane/utils';
import {
  getEntitlementUserFromSession,
  type EntitlementSession,
} from '@/lib/entitlement-session';
import { decodeImage } from './image-bitmap';

export type ImageStitchOutputType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ImageStitchOptions {
  width: number;
  gap: number;
  background: string;
  outputType: ImageStitchOutputType;
  quality: number;
  filename: string;
  brandFooter?: string;
}

export interface ImageStitchSource {
  width: number;
  height: number;
}

export interface ImageStitchLayoutItem {
  sourceIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageStitchLayout {
  width: number;
  height: number;
  background: string;
  items: ImageStitchLayoutItem[];
}

export interface ImageStitchPlanLimits {
  maxFiles: number;
  maxFileSize: number;
  maxCanvasPixels: number;
}

export interface ImageStitchEntitlements extends ImageStitchPlanLimits {
  isLoggedIn: boolean;
  canBatchExport: boolean;
  canUseBrandFooter: boolean;
  canUseWatermarkTemplate: boolean;
  canSaveHistory: boolean;
}

export const DEFAULT_IMAGE_STITCH_LIMITS = {
  free: {
    maxFiles: 12,
    maxFileSize: 10 * 1024 * 1024,
    maxCanvasPixels: 32_000_000,
  },
  commercial: {
    maxFiles: 40,
    maxFileSize: 50 * 1024 * 1024,
    maxCanvasPixels: 96_000_000,
  },
} satisfies Record<string, ImageStitchPlanLimits>;

export function getImageStitchEntitlements(
  session: EntitlementSession
): ImageStitchEntitlements {
  const user = getEntitlementUserFromSession(session);
  const isLoggedIn = Boolean(user);

  return {
    maxFiles: getLimit(user, 'image.stitch.maxFiles'),
    maxFileSize: getLimit(user, 'image.stitch.maxFileSize'),
    maxCanvasPixels: getLimit(user, 'image.stitch.maxCanvasPixels'),
    isLoggedIn,
    canBatchExport: canUseFeature(user, 'image.stitch.batch'),
    canUseBrandFooter: canUseFeature(user, 'image.stitch.brandFooter'),
    canUseWatermarkTemplate: canUseFeature(user, 'image.stitch.brandFooter'),
    canSaveHistory: isLoggedIn,
  };
}

export function getStitchOutputName(
  filename: string,
  outputType: ImageStitchOutputType
): string {
  const safeBase = filename.trim().replace(/\.[^.]+$/, '');
  const base = safeBase.length > 0 ? safeBase : 'stitched-long-image';
  const ext =
    outputType === 'image/jpeg' ? 'jpg' : outputType.replace('image/', '');
  return `${base}.${ext}`;
}

export function buildImageStitchLayout(
  sources: ImageStitchSource[],
  options: ImageStitchOptions
): ImageStitchLayout {
  const width = Math.max(1, Math.round(options.width));
  const gap = Math.max(0, Math.round(options.gap));
  const items: ImageStitchLayoutItem[] = [];
  let y = 0;

  sources.forEach((source, sourceIndex) => {
    const ratio = width / source.width;
    const height = Math.max(1, Math.round(source.height * ratio));
    items.push({ sourceIndex, x: 0, y, width, height });
    y += height + gap;
  });

  const height = items.length > 0 ? y - gap : 0;
  const background =
    options.outputType === 'image/jpeg' && options.background === 'transparent'
      ? '#ffffff'
      : options.background;

  return { width, height, background, items };
}

export function validateImageStitchLayout(
  layout: ImageStitchLayout,
  limits: ImageStitchPlanLimits
): void {
  if (layout.width * layout.height > limits.maxCanvasPixels) {
    throw new Error('Canvas is too large for the current plan');
  }
}

function validateImageStitchInputs(
  files: File[],
  limits: ImageStitchPlanLimits
): void {
  if (files.length > limits.maxFiles) {
    throw new Error('Too many files for the current plan');
  }
  if (files.some(file => file.size > limits.maxFileSize)) {
    throw new Error('File is too large for the current plan');
  }
}

export async function stitchImages(
  files: File[],
  options: ImageStitchOptions,
  limits: ImageStitchPlanLimits
): Promise<File> {
  validateImageStitchInputs(files, limits);

  const images = await Promise.all(files.map(decodeImage));
  try {
    const layout = buildImageStitchLayout(
      images.map(image => ({ width: image.width, height: image.height })),
      options
    );
    validateImageStitchLayout(layout, limits);

    const canvas = document.createElement('canvas');
    canvas.width = layout.width;
    canvas.height = layout.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available');

    if (layout.background !== 'transparent') {
      ctx.fillStyle = layout.background;
      ctx.fillRect(0, 0, layout.width, layout.height);
    }

    layout.items.forEach(item => {
      const image = images[item.sourceIndex]!;
      ctx.drawImage(image.source, item.x, item.y, item.width, item.height);
    });

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        result => {
          if (!result) return reject(new Error('Image stitch export failed'));
          resolve(result);
        },
        options.outputType,
        options.outputType === 'image/png' ? undefined : options.quality
      );
    });

    return new File(
      [blob],
      getStitchOutputName(options.filename, options.outputType),
      { type: blob.type || options.outputType }
    );
  } finally {
    // 长图往往一次解十几张,不显式释放会把解码后的位图全堆在内存里。
    images.forEach(image => image.close());
  }
}
