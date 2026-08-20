/**
 * 马赛克 / 模糊打码。
 *
 * 打码区域用「归一化矩形」存(0..1),而不是像素:用户可能先在缩略图上框选,
 * 再对原图出图;归一化后两者一致,也便于将来在不同尺寸的预览上复用同一份选区。
 */

export interface MosaicRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type MosaicMode = 'pixelate' | 'blur' | 'solid';

export const MOSAIC_MODES: MosaicMode[] = ['pixelate', 'blur', 'solid'];

/** 马赛克强度档位;数值是「一个色块占区域短边的比例的倒数」的基准。 */
export const MIN_STRENGTH = 1;
export const MAX_STRENGTH = 30;
export const DEFAULT_STRENGTH = 12;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 把归一化选区换算成源图像素矩形,并夹回图内。 */
export function toPixelRegion(
  region: MosaicRegion,
  width: number,
  height: number
): MosaicRegion {
  const w = clamp(Math.round(region.width * width), 1, width);
  const h = clamp(Math.round(region.height * height), 1, height);
  return {
    x: clamp(Math.round(region.x * width), 0, width - w),
    y: clamp(Math.round(region.y * height), 0, height - h),
    width: w,
    height: h,
  };
}

/**
 * 由强度算出像素块边长。
 *
 * 按区域短边取比例而不是给固定像素:同样的强度,在大图的大选区和小图的小选区上
 * 应当产生视觉上相当的遮蔽效果,固定像素会让小选区被一个色块糊死、大选区几乎没变化。
 */
export function resolveBlockSize(
  region: { width: number; height: number },
  strength: number
): number {
  const shortSide = Math.max(1, Math.min(region.width, region.height));
  const level = clamp(Math.round(strength), MIN_STRENGTH, MAX_STRENGTH);
  return Math.max(2, Math.round((shortSide * level) / 100));
}

/** 选区太小的话打码没有意义,也容易点歪。 */
export const MIN_REGION_PX = 8;

export function isUsableRegion(
  region: MosaicRegion,
  width: number,
  height: number
): boolean {
  const pixel = toPixelRegion(region, width, height);
  return pixel.width >= MIN_REGION_PX && pixel.height >= MIN_REGION_PX;
}

export function getMosaicFileName(
  filename: string,
  outputType: 'image/png' | 'image/jpeg' | 'image/webp'
): string {
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext =
    outputType === 'image/jpeg'
      ? 'jpg'
      : outputType === 'image/webp'
        ? 'webp'
        : 'png';
  return `masked-${base}.${ext}`;
}
