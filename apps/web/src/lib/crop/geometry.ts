/**
 * 裁剪框几何。
 *
 * 全部在源图像素坐标下计算,不用归一化坐标 —— 比例锁定涉及宽高比,归一化坐标里
 * 「1:1」并不是正方形(要再除以图片本身的宽高比),很容易算错。像素坐标下所见即所得。
 *
 * 这里不碰 DOM,交互逻辑因此可以完整测试;UI 只负责把指针位移换算成像素增量。
 */

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropBounds {
  width: number;
  height: number;
}

export type CropHandle =
  | 'move'
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w';

/** 裁剪框最小边长(源图像素),防止被拖成 0 甚至负数。 */
export const MIN_CROP_SIZE = 16;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 把框夹回图内,并保证不小于最小边长。 */
export function clampCropRect(rect: CropRect, bounds: CropBounds): CropRect {
  const width = clamp(Math.round(rect.width), MIN_CROP_SIZE, bounds.width);
  const height = clamp(Math.round(rect.height), MIN_CROP_SIZE, bounds.height);

  return {
    x: clamp(Math.round(rect.x), 0, bounds.width - width),
    y: clamp(Math.round(rect.y), 0, bounds.height - height),
    width,
    height,
  };
}

/** 图内最大的、符合给定宽高比的居中框;aspect 为空时就是整张图。 */
export function centeredCropRect(
  bounds: CropBounds,
  aspect?: number | null
): CropRect {
  if (!aspect || !Number.isFinite(aspect) || aspect <= 0) {
    return { x: 0, y: 0, width: bounds.width, height: bounds.height };
  }

  const boundsAspect = bounds.width / bounds.height;
  const width = boundsAspect > aspect ? bounds.height * aspect : bounds.width;
  const height = boundsAspect > aspect ? bounds.height : bounds.width / aspect;

  return clampCropRect(
    {
      x: (bounds.width - width) / 2,
      y: (bounds.height - height) / 2,
      width,
      height,
    },
    bounds
  );
}

export function moveCropRect(
  rect: CropRect,
  dx: number,
  dy: number,
  bounds: CropBounds
): CropRect {
  // 平移不改变尺寸:先按原尺寸算出可放置范围,再夹住位置。
  return {
    x: clamp(Math.round(rect.x + dx), 0, bounds.width - rect.width),
    y: clamp(Math.round(rect.y + dy), 0, bounds.height - rect.height),
    width: rect.width,
    height: rect.height,
  };
}

const MOVES_LEFT: CropHandle[] = ['nw', 'w', 'sw'];
const MOVES_RIGHT: CropHandle[] = ['ne', 'e', 'se'];
const MOVES_TOP: CropHandle[] = ['nw', 'n', 'ne'];
const MOVES_BOTTOM: CropHandle[] = ['sw', 's', 'se'];

/**
 * 按手柄拖动缩放裁剪框。
 *
 * 以「被拖动手柄的对角」为锚点:拖右下角时左上角不动,反之亦然。边中点手柄只驱动
 * 一条边,另一条在锁比例时按中心对称扩展。
 *
 * 关键点是「缩到图内」必须按锚点的可用空间算,而不是按图的整体尺寸。否则一个贴边
 * 的框在锁定比例下被拖大时,会先算出超出图外的尺寸,再被平移夹回来 —— 结果既丢了
 * 锚点(对角跟着跑),又丢了比例(宽高被各自截断)。
 */
export function resizeCropRect(
  rect: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  bounds: CropBounds,
  aspect?: number | null
): CropRect {
  if (handle === 'move') return moveCropRect(rect, dx, dy, bounds);

  const anchorRight = MOVES_LEFT.includes(handle);
  const anchorBottom = MOVES_TOP.includes(handle);
  const anchorX = anchorRight ? rect.x + rect.width : rect.x;
  const anchorY = anchorBottom ? rect.y + rect.height : rect.y;
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const horizontalOnly = handle === 'e' || handle === 'w';
  const verticalOnly = handle === 'n' || handle === 's';

  let width =
    rect.width +
    (MOVES_RIGHT.includes(handle) ? dx : MOVES_LEFT.includes(handle) ? -dx : 0);
  let height =
    rect.height +
    (MOVES_BOTTOM.includes(handle) ? dy : MOVES_TOP.includes(handle) ? -dy : 0);

  // 拖过头时不翻转,而是收到最小边长
  width = Math.max(MIN_CROP_SIZE, width);
  height = Math.max(MIN_CROP_SIZE, height);

  // 锚点方向上还剩多少空间;居中扩展的那一轴受两侧较小的一边限制。
  const maxWidth = verticalOnly
    ? 2 * Math.min(centerX, bounds.width - centerX)
    : anchorRight
      ? anchorX
      : bounds.width - anchorX;
  const maxHeight = horizontalOnly
    ? 2 * Math.min(centerY, bounds.height - centerY)
    : anchorBottom
      ? anchorY
      : bounds.height - anchorY;

  if (aspect && Number.isFinite(aspect) && aspect > 0) {
    // 主导轴定另一轴:横向手柄以宽定高,纵向以高定宽,角手柄取变化更大的那个
    if (horizontalOnly) height = width / aspect;
    else if (verticalOnly) width = height * aspect;
    else if (width / height > aspect) height = width / aspect;
    else width = height * aspect;

    // 等比缩到锚点可用空间内,比例与锚点都保住
    const scale = Math.min(1, maxWidth / width, maxHeight / height);
    width *= scale;
    height *= scale;
  } else {
    width = Math.min(width, maxWidth);
    height = Math.min(height, maxHeight);
  }

  width = Math.max(MIN_CROP_SIZE, width);
  height = Math.max(MIN_CROP_SIZE, height);

  const x = verticalOnly
    ? centerX - width / 2
    : anchorRight
      ? anchorX - width
      : anchorX;
  const y = horizontalOnly
    ? centerY - height / 2
    : anchorBottom
      ? anchorY - height
      : anchorY;

  return clampCropRect({ x, y, width, height }, bounds);
}

/** 常用裁剪比例;null 表示自由裁剪。 */
export const CROP_ASPECTS: { key: string; value: number | null }[] = [
  { key: 'free', value: null },
  { key: 'square', value: 1 },
  { key: 'photo43', value: 4 / 3 },
  { key: 'photo34', value: 3 / 4 },
  { key: 'wide169', value: 16 / 9 },
  { key: 'story916', value: 9 / 16 },
];
