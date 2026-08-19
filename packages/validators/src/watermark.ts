import { z } from 'zod';

/**
 * 水印位置。
 *
 * 原本只有 center / bottom-right / tile 三种,连「左上角」这种最常见的诉求都满足
 * 不了。扩成九宫格 + 平铺,并保留原有三个取值,老配置不会失效。
 */
export const imageWatermarkPositionEnum = z.enum([
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
  'tile',
]);

export type ImageWatermarkPosition = z.infer<typeof imageWatermarkPositionEnum>;

/** 九宫格顺序,供 UI 直接铺 3×3。 */
export const IMAGE_WATERMARK_GRID: ImageWatermarkPosition[] = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

export type WatermarkHorizontalAnchor = 'start' | 'middle' | 'end';
export type WatermarkVerticalAnchor = 'top' | 'middle' | 'bottom';

export interface WatermarkAnchor {
  /** 锚点在图片中的像素坐标。 */
  x: number;
  y: number;
  horizontal: WatermarkHorizontalAnchor;
  vertical: WatermarkVerticalAnchor;
}

function horizontalOf(
  position: ImageWatermarkPosition
): WatermarkHorizontalAnchor {
  if (position.endsWith('-left')) return 'start';
  if (position.endsWith('-right')) return 'end';
  return 'middle';
}

function verticalOf(position: ImageWatermarkPosition): WatermarkVerticalAnchor {
  if (position.startsWith('top-')) return 'top';
  if (position.startsWith('bottom-')) return 'bottom';
  return 'middle';
}

/**
 * 把位置解算成像素锚点。
 *
 * 放在 validators 而不是各端各写一份:本地走 canvas 的 textAlign/textBaseline,
 * 服务端走 SVG 的 text-anchor/dominant-baseline,两套 API 不同但坐标必须一致,
 * 否则同一组参数在两种处理模式下水印会落在不同位置。
 *
 * `tile` 没有单一锚点,调用方应先判断再走平铺分支;这里按 center 返回以免调用方拿到
 * 未定义值。
 */
export function resolveWatermarkAnchor(
  position: ImageWatermarkPosition,
  width: number,
  height: number,
  margin: number
): WatermarkAnchor {
  const horizontal = horizontalOf(position);
  const vertical = verticalOf(position);

  return {
    x:
      horizontal === 'start'
        ? margin
        : horizontal === 'end'
          ? width - margin
          : width / 2,
    y:
      vertical === 'top'
        ? margin
        : vertical === 'bottom'
          ? height - margin
          : height / 2,
    horizontal,
    vertical,
  };
}

/** 默认外边距:按短边比例给,小图不会顶边、大图不会离得太远。 */
export function resolveWatermarkMargin(
  width: number,
  height: number,
  ratio = 0.04
): number {
  return Math.max(12, Math.round(Math.min(width, height) * ratio));
}
