'use client';

/**
 * 通用抠图合成:把带 alpha 的抠图输出成透明 PNG 或纯色底图片。
 *
 * 与证件照的 compositeIdPhoto 分开:那边要按预设尺寸裁剪缩放,这边保持原尺寸,
 * 且透明背景是主用途 —— 两者的取舍不同,硬合成一个函数只会让参数互相打架。
 */

import { createSurface } from '@/lib/processing/canvas-surface';

export type CutoutBackground =
  | { kind: 'transparent' }
  | { kind: 'color'; color: string };

export type CutoutOutputType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface CompositeCutoutOptions {
  background: CutoutBackground;
  outputType: CutoutOutputType;
  quality?: number;
}

/** 透明背景只有 PNG/WebP 保得住;JPEG 没有 alpha 通道。 */
export function supportsTransparency(outputType: CutoutOutputType): boolean {
  return outputType !== 'image/jpeg';
}

/**
 * 输出格式与背景选择是否自洽。
 *
 * 选了透明 + JPEG 时,canvas 会把 alpha 直接压成黑色,用户拿到一张黑底图却不知道
 * 为什么 —— 必须在 UI 上说破,而不是默默填白。
 */
export function cutoutSelectionIsValid(
  background: CutoutBackground,
  outputType: CutoutOutputType
): boolean {
  return background.kind !== 'transparent' || supportsTransparency(outputType);
}

export async function compositeCutout(
  cutout: ImageBitmap,
  options: CompositeCutoutOptions
): Promise<Blob> {
  const surface = createSurface(cutout.width, cutout.height);
  const { ctx } = surface;

  if (options.background.kind === 'color') {
    ctx.fillStyle = options.background.color;
    ctx.fillRect(0, 0, surface.width, surface.height);
  }

  ctx.drawImage(cutout, 0, 0);

  return surface.toBlob(
    options.outputType,
    options.outputType === 'image/png' ? undefined : (options.quality ?? 0.92)
  );
}

const EXTENSIONS: Record<CutoutOutputType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export function getCutoutFileName(
  filename: string,
  outputType: CutoutOutputType
): string {
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return `cutout-${base}.${EXTENSIONS[outputType]}`;
}
