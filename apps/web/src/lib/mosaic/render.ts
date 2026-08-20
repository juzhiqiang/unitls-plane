'use client';

import { withDecodedImage } from '@/lib/processing/image-bitmap';
import { createSurface } from '@/lib/processing/canvas-surface';
import {
  resolveBlockSize,
  toPixelRegion,
  type MosaicMode,
  type MosaicRegion,
} from './geometry';

export type MosaicOutputType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface MosaicRenderOptions {
  regions: MosaicRegion[];
  mode: MosaicMode;
  strength: number;
  outputType: MosaicOutputType;
  quality?: number;
  /** solid 模式的遮盖色。 */
  solidColor?: string;
}

/**
 * 用「缩小再放大」实现像素化。
 *
 * 直接逐像素求平均要把整块 ImageData 读回 JS,大图上很慢;交给 canvas 先把选区画到
 * 一个极小的离屏画布、再关掉平滑放大回去,像素块由 GPU/浏览器负责,快且效果一致。
 */
function pixelateRegion(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  source: CanvasImageSource,
  region: MosaicRegion,
  blockSize: number
): void {
  const cols = Math.max(1, Math.round(region.width / blockSize));
  const rows = Math.max(1, Math.round(region.height / blockSize));
  const small = createSurface(cols, rows);

  small.ctx.drawImage(
    source,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    cols,
    rows
  );

  const previous = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    small.ctx.canvas as unknown as CanvasImageSource,
    0,
    0,
    cols,
    rows,
    region.x,
    region.y,
    region.width,
    region.height
  );
  ctx.imageSmoothingEnabled = previous;
}

function blurRegion(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  source: CanvasImageSource,
  region: MosaicRegion,
  blockSize: number
): void {
  ctx.save();
  // 只在选区内生效,否则 filter 会把整张图糊掉
  ctx.beginPath();
  ctx.rect(region.x, region.y, region.width, region.height);
  ctx.clip();
  ctx.filter = `blur(${Math.max(2, blockSize)}px)`;
  ctx.drawImage(
    source,
    region.x,
    region.y,
    region.width,
    region.height,
    region.x,
    region.y,
    region.width,
    region.height
  );
  ctx.restore();
}

export async function renderMosaic(
  source: Blob,
  options: MosaicRenderOptions
): Promise<Blob> {
  return withDecodedImage(source, async image => {
    const surface = createSurface(image.width, image.height);
    const ctx = surface.ctx;

    ctx.drawImage(image.source, 0, 0);

    for (const region of options.regions) {
      const pixel = toPixelRegion(region, image.width, image.height);
      const blockSize = resolveBlockSize(pixel, options.strength);

      if (options.mode === 'solid') {
        ctx.fillStyle = options.solidColor ?? '#111111';
        ctx.fillRect(pixel.x, pixel.y, pixel.width, pixel.height);
        continue;
      }

      if (options.mode === 'blur') {
        blurRegion(ctx, image.source, pixel, blockSize);
        continue;
      }

      pixelateRegion(ctx, image.source, pixel, blockSize);
    }

    return surface.toBlob(
      options.outputType,
      options.outputType === 'image/png' ? undefined : (options.quality ?? 0.92)
    );
  });
}
