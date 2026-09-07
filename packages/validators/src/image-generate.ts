import { z } from 'zod';

export const imageGenerateModeEnum = z.enum([
  'text_to_image',
  'image_to_image',
  'inpaint',
]);

/**
 * 尺寸只校验形状("auto" 或 "WxH"):各来源支持的尺寸来自 API 侧的
 * AI_IMAGE_PROVIDERS 运行时配置,validators 包拿不到也不该拿到。存在性由
 * ImageGenerationService 在解析来源时交叉校验。
 */
export const imageGenerateSizeSchema = z
  .string()
  .trim()
  .regex(/^(auto|\d{2,5}x\d{2,5})$/, 'size must be "auto" or "WxH"');

export const imageGenerateQualityEnum = z.enum(['auto', 'standard', 'high']);

export const imageGenerateBackgroundEnum = z.enum(['opaque', 'transparent']);

/** 会话 id 与一次提交的分组 id,均由客户端 crypto.randomUUID 生成。 */
export const imageGenerateGroupIdSchema = z.string().uuid();

export const imageGenerateStyleEnum = z.enum([
  'photographic',
  'illustration',
  'anime',
  'three_d',
  'watercolor',
  'line_art',
]);

/** prompt 最大长度,前后端共用,避免跨包重复魔数。 */
export const IMAGE_GENERATE_PROMPT_MAX_LENGTH = 5000;

/**
 * 生图来源 id。
 *
 * 这里只校验形状,不校验"这个 id 是否真的配置过":可用来源来自 API 侧的
 * AI_IMAGE_PROVIDERS 运行时配置,validators 包拿不到也不该拿到。存在性与能力
 * (是否支持图生图)由 ImageGenerationService 在解析来源时判定。
 */
export const imageGenerateProviderIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9][a-z0-9_-]*$/i,
    'providerId must start with a letter or digit and contain only letters, digits, "-" or "_"'
  );

/** 图生图(融合)最多同时携带的参考图张数。 */
export const IMAGE_GENERATE_MAX_REFERENCE_IMAGES = 4;

/**
 * 每个 mode 允许的输入文件数量范围,用于把模式契约收在一处。
 *
 * image_to_image 是 1..N:单张是常规图生图,多张是图片融合(全部参考图一起发给上游)。
 */
export const IMAGE_GENERATE_INPUT_FILE_COUNT: Record<
  z.infer<typeof imageGenerateModeEnum>,
  { min: number; max: number }
> = {
  text_to_image: { min: 0, max: 0 },
  image_to_image: { min: 1, max: IMAGE_GENERATE_MAX_REFERENCE_IMAGES },
  inpaint: { min: 2, max: 2 },
};

export const imageGenerateTaskConfigSchema = z
  .object({
    mode: imageGenerateModeEnum,
    prompt: z.string().trim().min(1).max(IMAGE_GENERATE_PROMPT_MAX_LENGTH),
    size: imageGenerateSizeSchema.default('1024x1024'),
    quality: imageGenerateQualityEnum.default('high'),
    style: imageGenerateStyleEnum.optional(),
    /** 省略时用服务端配置里的第一个来源,保持历史任务与单来源部署可用。 */
    providerId: imageGenerateProviderIdSchema.optional(),
    /** 省略时上游用默认背景;transparent 依赖 PNG 产物(本站恒为 PNG)。 */
    background: imageGenerateBackgroundEnum.optional(),
    /** 对话式布局的会话归属;非法值由 API 在建任务时丢弃,processor 校验形状。 */
    sessionId: imageGenerateGroupIdSchema.optional(),
    /** 一次提交的 N 张图共享的分组 id,前端按它聚成一条消息。 */
    clientGroupId: imageGenerateGroupIdSchema.optional(),
    /** 由 processor 传入 task.inputFileIds.length,不由客户端提供。 */
    inputFileCount: z.number().int().min(0),
  })
  .superRefine((value, ctx) => {
    const range = IMAGE_GENERATE_INPUT_FILE_COUNT[value.mode];
    if (value.inputFileCount < range.min || value.inputFileCount > range.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['inputFileCount'],
        message:
          range.min === range.max
            ? `mode ${value.mode} requires exactly ${range.min} input file(s)`
            : `mode ${value.mode} requires ${range.min}-${range.max} input files`,
      });
    }
  });

export type ImageGenerateMode = z.infer<typeof imageGenerateModeEnum>;
export type ImageGenerateSize = z.infer<typeof imageGenerateSizeSchema>;
export type ImageGenerateQuality = z.infer<typeof imageGenerateQualityEnum>;
export type ImageGenerateBackground = z.infer<
  typeof imageGenerateBackgroundEnum
>;
export type ImageGenerateStyle = z.infer<typeof imageGenerateStyleEnum>;
export type ImageGenerateProviderId = z.infer<
  typeof imageGenerateProviderIdSchema
>;
export type ImageGenerateTaskConfig = z.infer<
  typeof imageGenerateTaskConfigSchema
>;
