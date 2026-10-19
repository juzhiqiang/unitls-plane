/**
 * 证件照质量检查。
 *
 * 对应参考实现 quality.py:inspect_photo 的 8 项。两端共用同一份判定，
 * 保证用户在本地路与服务端路看到的结论一致。
 *
 * 纯函数：输入是普通数组/对象，不依赖 sharp、DOM、模型。
 * 调用方负责先跑人脸检测与分割，再把结果传进来。
 */

import { eyeTiltDegrees, type FaceDetection } from './id-photo-layout';

export interface QualityItem {
  /** 稳定的 i18n key，UI 用 `quality.items.${name}` 取文案。 */
  name:
    | 'faceCount'
    | 'faceCentered'
    | 'faceRatio'
    | 'eyeTilt'
    | 'headroom'
    | 'sharpness'
    | 'exposure'
    | 'matteEdge';
  /** 实测值，已格式化成展示串（如 `35%`、`+1.2°`）。 */
  value: string;
  passed: boolean;
  /** 建议文案的 i18n key，UI 用 `quality.hints.${hint}` 取。 */
  hint: string;
}

export interface QualityReport {
  items: QualityItem[];
  /** 通过项占比，0..100。 */
  score: number;
  passed: boolean;
}

const FACE_CENTER_TOLERANCE = 0.12;
const FACE_RATIO_MIN = 0.26;
const FACE_RATIO_MAX = 0.42;
const MAX_EYE_TILT = 5;
const MIN_HEADROOM = 0.03;
const MIN_SHARPNESS = 30;
const EXPOSURE_MIN = 35;
const EXPOSURE_MAX = 225;
const MAX_TRANSLUCENT_RATIO = 0.75;
const MAX_SHARPNESS_DIMENSION = 512;
const MAX_BRIGHTNESS_SAMPLES = 200_000;

type RgbChannels = 3 | 4;

/**
 * 按缓冲区长度推断通道数。
 *
 * 本地路传 canvas `ImageData.data`（RGBA），服务端路传 sharp 解出的 RGB。
 * 同一张图两种布局必须得到相同的清晰度/曝光结论，因此所有读像素的地方都由
 * 这里统一决定步长，而不是硬编码 3 通道。
 *
 * 长度既不是 `width × height × 3` 也不是 `× 4` 时直接抛错：这通常意味着
 * 调用方传错了尺寸或缓冲区，静默猜测会让两端结论继续悄悄分叉。
 */
function resolveRgbChannels(
  length: number,
  width: number,
  height: number
): RgbChannels {
  const pixels = width * height;
  if (Number.isFinite(pixels) && pixels > 0) {
    if (length === pixels * 4) return 4;
    if (length === pixels * 3) return 3;
  }
  throw new RangeError(
    `rgb buffer length ${length} does not match ${width}x${height} as RGB or RGBA`
  );
}

function pixelOffset(pixelIndex: number, channels: RgbChannels): number {
  return pixelIndex * channels;
}

/**
 * Laplacian 方差，清晰度指标。
 *
 * 3×3 卷积核 [0,1,0; 1,-4,1; 0,1,0]，只取灰度。方差越低越糊。
 * 为了不被大图拖慢，按最大 512 边降采样 —— 清晰度的相对比较不需要原分辨率。
 *
 * 采样中心的有效范围是 `[1, width - 2]`（上下左右都要取邻居），因此每轴
 * 采样点数是 `floor((dimension - 3) / step) + 1`。按这个上界循环，`x + 1`
 * 与 `y + 1` 一定落在图像内，不会读到越界像素。
 */
function laplacianVariance(
  rgb: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  channels: RgbChannels
): number {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 3 ||
    height < 3
  ) {
    return 0;
  }

  const step = Math.max(
    1,
    Math.ceil(Math.max(width, height) / MAX_SHARPNESS_DIMENSION)
  );
  const gw = Math.floor((width - 3) / step) + 1;
  const gh = Math.floor((height - 3) / step) + 1;
  if (gw <= 0 || gh <= 0) return 0;

  const grayAt = (x: number, y: number): number => {
    const p = pixelOffset(y * width + x, channels);
    return (
      (rgb[p] ?? 0) * 0.299 +
      (rgb[p + 1] ?? 0) * 0.587 +
      (rgb[p + 2] ?? 0) * 0.114
    );
  };

  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let gy = 0; gy < gh; gy += 1) {
    const y = 1 + gy * step;
    for (let gx = 0; gx < gw; gx += 1) {
      const x = 1 + gx * step;
      const value =
        grayAt(x, y - 1) +
        grayAt(x, y + 1) +
        grayAt(x - 1, y) +
        grayAt(x + 1, y) -
        4 * grayAt(x, y);
      sum += value;
      sumSq += value * value;
      count += 1;
    }
  }
  if (!count) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

function meanBrightness(
  rgb: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  channels: RgbChannels
): number {
  const total = width * height;
  if (!Number.isFinite(total) || total <= 0) return 0;
  // ceil 才能保证采样数不超过上限；floor 会在面积略大于上限时退化为全量扫描。
  const stride = Math.max(1, Math.ceil(total / MAX_BRIGHTNESS_SAMPLES));
  let sum = 0;
  let count = 0;
  for (let i = 0; i < total; i += stride) {
    const p = pixelOffset(i, channels);
    sum += ((rgb[p] ?? 0) + (rgb[p + 1] ?? 0) + (rgb[p + 2] ?? 0)) / 3;
    count += 1;
  }
  return count ? sum / count : 0;
}

interface MatteStats {
  /** 半透明像素（0 < alpha < 255）占比，0..1。 */
  translucentRatio: number;
  /** 是否至少有一个像素属于前景（alpha > 0）。 */
  hasForeground: boolean;
}

/**
 * 统计分割蒙版的半透明像素。
 *
 * 兼容两种输入：
 * - 单通道 alpha（长度 = width × height）；
 * - 交错 RGBA（长度 = width × height × 4，只取第 4 通道）。
 *
 * alpha 长度与图像尺寸不一致时，只统计双方都有数据的部分，避免把 RGB
 * 通道或越界区域误当成 alpha。全透明蒙版（没有任何 alpha > 0）由调用方
 * 判为未通过：它不是「边缘干净」，而是「没有前景」。
 */
function inspectMatte(
  alpha: Uint8ClampedArray | Uint8Array,
  pixelCount: number
): MatteStats | null {
  if (!Number.isFinite(pixelCount) || pixelCount <= 0 || !alpha.length) {
    return null;
  }
  const isRgba = alpha.length === pixelCount * 4;
  const channelStride = isRgba ? 4 : 1;
  const channelOffset = isRgba ? 3 : 0;
  const samples = Math.min(
    pixelCount,
    Math.floor(alpha.length / channelStride)
  );
  if (samples <= 0) return null;

  let translucent = 0;
  let foreground = 0;
  for (let i = 0; i < samples; i += 1) {
    const a = alpha[i * channelStride + channelOffset] ?? 0;
    if (a > 0 && a < 255) translucent += 1;
    if (a > 0) foreground += 1;
  }
  return {
    translucentRatio: translucent / samples,
    hasForeground: foreground > 0,
  };
}

export function inspectIdPhoto(input: {
  rgb: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
  face: FaceDetection | null;
  faceCount: number;
  /**
   * 可选：分割 alpha。支持单通道（长度 = width × height），也支持交错 RGBA
   * （长度 = width × height × 4，只取第 4 通道）。提供该参数（即使为空数组）
   * 时始终输出 matteEdge 项。
   */
  alpha?: Uint8ClampedArray | Uint8Array;
}): QualityReport {
  const { rgb, width, height, face, faceCount, alpha } = input;
  const channels = resolveRgbChannels(rgb.length, width, height);
  const items: QualityItem[] = [];

  items.push({
    name: 'faceCount',
    value: String(faceCount),
    passed: faceCount === 1,
    hint: 'singleFrontalPortrait',
  });

  if (face) {
    const faceCenterX = face.box.x + face.box.width / 2;
    const centerOffset = Math.abs(faceCenterX - width / 2) / width;
    items.push({
      name: 'faceCentered',
      value: `${Math.round(centerOffset * 100)}%`,
      passed: centerOffset < FACE_CENTER_TOLERANCE,
      hint: 'adjustHorizontalPosition',
    });

    const ratio = face.box.width / width;
    items.push({
      name: 'faceRatio',
      value: `${Math.round(ratio * 100)}%`,
      passed: ratio >= FACE_RATIO_MIN && ratio <= FACE_RATIO_MAX,
      hint: 'faceRatioRange',
    });

    if (face.landmarks.length >= 2) {
      const tilt = eyeTiltDegrees(face.landmarks);
      items.push({
        name: 'eyeTilt',
        value: `${tilt >= 0 ? '+' : ''}${tilt.toFixed(1)}°`,
        passed: Math.abs(tilt) <= MAX_EYE_TILT,
        hint: 'levelEyes',
      });
    } else {
      // 少于两个点无法算眼线，不能把 eyeTiltDegrees 的兜底 0 当成「水平」。
      items.push({
        name: 'eyeTilt',
        value: '—',
        passed: false,
        hint: 'faceNotDetected',
      });
    }

    const headroom = face.box.y / height;
    items.push({
      name: 'headroom',
      value: `${Math.round(headroom * 100)}%`,
      passed: headroom >= MIN_HEADROOM,
      hint: 'headroomTooSmall',
    });
  } else {
    // 没有人脸时，这四项无法判定，按未通过计（避免「没检测到却满分」）
    for (const name of [
      'faceCentered',
      'faceRatio',
      'eyeTilt',
      'headroom',
    ] as const) {
      items.push({ name, value: '—', passed: false, hint: 'faceNotDetected' });
    }
  }

  const sharpness = laplacianVariance(rgb, width, height, channels);
  items.push({
    name: 'sharpness',
    value: sharpness.toFixed(0),
    passed: sharpness >= MIN_SHARPNESS,
    hint: 'avoidBlurrySource',
  });

  const brightness = meanBrightness(rgb, width, height, channels);
  items.push({
    name: 'exposure',
    value: `${brightness.toFixed(0)}/255`,
    passed: brightness >= EXPOSURE_MIN && brightness <= EXPOSURE_MAX,
    hint: 'avoidUnderexposedOrBlown',
  });

  if (alpha !== undefined) {
    const matte = inspectMatte(alpha, width * height);
    // 空数组 / 尺寸不匹配也要保留这一项：少一项会改变评分分母。
    items.push(
      matte
        ? {
            name: 'matteEdge',
            value: `${(matte.translucentRatio * 100).toFixed(1)}%`,
            passed:
              matte.translucentRatio < MAX_TRANSLUCENT_RATIO &&
              matte.hasForeground,
            hint: 'checkHairAndShoulder',
          }
        : {
            name: 'matteEdge',
            value: '—',
            passed: false,
            hint: 'checkHairAndShoulder',
          }
    );
  }

  const passedCount = items.filter(i => i.passed).length;
  const score = Math.round((100 * passedCount) / Math.max(1, items.length));

  return { items, score, passed: passedCount === items.length };
}
