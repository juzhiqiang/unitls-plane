'use client';

import { withDecodedImage } from '@/lib/processing/image-bitmap';
import { createSurface } from '@/lib/processing/canvas-surface';
import { assertEncodedAs } from '@/lib/processing/image-encoding-support';
import type { CropRect } from './geometry';

export type CropOutputType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/avif';

export interface CropRenderOptions {
  rect: CropRect;
  outputType: CropOutputType;
  quality: number;
  /** 输出尺寸;省略即按裁剪框的原始像素输出。 */
  resize?: { width: number; height: number } | null;
}

/** 勾选「锁定比例」时,由宽度反推高度,避免用户手动算。 */
export function resolveOutputSize(
  rect: CropRect,
  resize: { width: number; height: number } | null | undefined
): { width: number; height: number } {
  if (!resize) return { width: rect.width, height: rect.height };
  return {
    width: Math.max(1, Math.round(resize.width)),
    height: Math.max(1, Math.round(resize.height)),
  };
}

export async function renderCrop(
  source: Blob,
  options: CropRenderOptions
): Promise<Blob> {
  const { rect } = options;
  const size = resolveOutputSize(rect, options.resize);

  return withDecodedImage(source, async image => {
    const surface = createSurface(size.width, size.height);
    surface.ctx.drawImage(
      image.source,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      size.width,
      size.height
    );

    const blob = await surface.toBlob(
      options.outputType,
      options.outputType === 'image/png' ? undefined : options.quality
    );
    // 与 convert 同一条原则:toBlob 对不支持的格式会静默回退成 PNG,必须拦下。
    assertEncodedAs(blob, options.outputType);
    return blob;
  });
}

const EXTENSIONS: Record<CropOutputType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

export function getCropFileName(
  filename: string,
  outputType: CropOutputType
): string {
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return `cropped-${base}.${EXTENSIONS[outputType]}`;
}
