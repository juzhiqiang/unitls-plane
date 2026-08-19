import { z } from 'zod';

export const idPhotoPresetEnum = z.enum([
  'one_inch',
  'two_inch',
  'small_one_inch',
  'passport',
]);

export const idPhotoOutputTypeEnum = z.enum(['image/jpeg', 'image/png']);
export const idPhotoSegmentationModeEnum = z.enum(['local', 'ai']);

export const idPhotoCropSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  /**
   * 裁剪框相对「基准框」的缩放,只放大不缩小。
   *
   * 基准框是源图内符合目标宽高比的最大居中框,它已经贴到了源图的某一条边;
   * scale < 1 会让裁剪框超出源图,需要补背景,不属于证件照裁剪的语义。
   */
  scale: z.number().min(1).max(3),
});

export const idPhotoBackgroundColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .transform(value => value.toLowerCase());

export const idPhotoTaskConfigSchema = z.object({
  preset: idPhotoPresetEnum,
  backgroundColor: idPhotoBackgroundColorSchema,
  outputType: idPhotoOutputTypeEnum.default('image/jpeg'),
  segmentationMode: idPhotoSegmentationModeEnum.default('local'),
  dpi: z.literal(300).default(300),
  crop: idPhotoCropSchema.optional(),
});

export const idPhotoPresetSpecs = {
  one_inch: {
    key: 'one_inch',
    widthPx: 295,
    heightPx: 413,
    dpi: 300,
    defaultBackground: '#438edb',
  },
  two_inch: {
    key: 'two_inch',
    widthPx: 413,
    heightPx: 626,
    dpi: 300,
    defaultBackground: '#438edb',
  },
  small_one_inch: {
    key: 'small_one_inch',
    widthPx: 260,
    heightPx: 378,
    dpi: 300,
    defaultBackground: '#438edb',
  },
  passport: {
    key: 'passport',
    widthPx: 413,
    heightPx: 531,
    dpi: 300,
    defaultBackground: '#ffffff',
  },
} as const;

export type IdPhotoPreset = z.infer<typeof idPhotoPresetEnum>;
export type IdPhotoOutputType = z.infer<typeof idPhotoOutputTypeEnum>;
export type IdPhotoSegmentationMode = z.infer<
  typeof idPhotoSegmentationModeEnum
>;
export type IdPhotoCrop = z.infer<typeof idPhotoCropSchema>;
export type IdPhotoTaskConfig = z.infer<typeof idPhotoTaskConfigSchema>;

export function normalizeHexColor(value: string): string {
  return idPhotoBackgroundColorSchema.parse(value);
}

/** 不做任何偏移与缩放,等价于居中裁剪 —— 也是历史行为。 */
export const DEFAULT_ID_PHOTO_CROP: IdPhotoCrop = { x: 0.5, y: 0.5, scale: 1 };

export interface IdPhotoCropBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 把归一化的 crop 解算成源图像素坐标下的裁剪框。
 *
 * 放在 validators 而不是各端各写一份:本地(canvas)与服务端(sharp)必须得出
 * 完全一致的框,否则同一组参数在两种处理模式下会产出不同的照片 —— 证件照最忌讳
 * 这个。两边都调用这一个函数,就没有漂移的空间。
 *
 * 语义:
 * - 基准框 = 源图内符合目标宽高比的最大居中框;
 * - scale 把基准框等比缩小(即放大画面),scale=1 时就是基准框;
 * - x/y 是裁剪框中心在源图中的归一化坐标,0.5/0.5 为居中;
 * - 框会被夹回源图范围内,保证 sharp.extract 不会越界。
 */
export function resolveIdPhotoCropBox(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  crop: IdPhotoCrop = DEFAULT_ID_PHOTO_CROP
): IdPhotoCropBox {
  const targetRatio = targetWidth / targetHeight;
  const sourceRatio = sourceWidth / sourceHeight;
  const baseWidth =
    sourceRatio > targetRatio ? sourceHeight * targetRatio : sourceWidth;
  const baseHeight =
    sourceRatio > targetRatio ? sourceHeight : sourceWidth / targetRatio;

  const scale = Math.max(1, crop.scale);
  const width = clamp(Math.round(baseWidth / scale), 1, sourceWidth);
  const height = clamp(Math.round(baseHeight / scale), 1, sourceHeight);

  return {
    left: clamp(
      Math.round(crop.x * sourceWidth - width / 2),
      0,
      sourceWidth - width
    ),
    top: clamp(
      Math.round(crop.y * sourceHeight - height / 2),
      0,
      sourceHeight - height
    ),
    width,
    height,
  };
}

/**
 * 把 crop 夹回合法范围,返回归一化参数。
 *
 * 与 resolveIdPhotoCropBox 共用同一套边界逻辑(直接由解算出的框反推中心),
 * 这样裁剪 UI 里能拖到的位置,和实际出图的裁剪范围严格一致。
 */
export function clampIdPhotoCrop(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  crop: IdPhotoCrop = DEFAULT_ID_PHOTO_CROP
): IdPhotoCrop {
  const box = resolveIdPhotoCropBox(
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
    crop
  );

  return {
    x: (box.left + box.width / 2) / sourceWidth,
    y: (box.top + box.height / 2) / sourceHeight,
    scale: Math.min(3, Math.max(1, crop.scale)),
  };
}
