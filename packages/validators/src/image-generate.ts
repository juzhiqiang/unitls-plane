import { z } from 'zod';

export const imageGenerateModeEnum = z.enum([
  'text_to_image',
  'image_to_image',
  'inpaint',
]);

export const imageGenerateSizeEnum = z.enum([
  '1024x1024',
  '1024x1536',
  '1536x1024',
]);

export const imageGenerateQualityEnum = z.enum(['standard', 'high']);

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

/** 每个 mode 要求的输入文件数量,用于把模式契约收在一处。 */
export const IMAGE_GENERATE_INPUT_FILE_COUNT: Record<
  z.infer<typeof imageGenerateModeEnum>,
  number
> = {
  text_to_image: 0,
  image_to_image: 1,
  inpaint: 2,
};

export const imageGenerateTaskConfigSchema = z
  .object({
    mode: imageGenerateModeEnum,
    prompt: z.string().trim().min(1).max(IMAGE_GENERATE_PROMPT_MAX_LENGTH),
    size: imageGenerateSizeEnum.default('1024x1024'),
    quality: imageGenerateQualityEnum.default('high'),
    style: imageGenerateStyleEnum.optional(),
    /** 由 processor 传入 task.inputFileIds.length,不由客户端提供。 */
    inputFileCount: z.number().int().min(0),
  })
  .superRefine((value, ctx) => {
    const expected = IMAGE_GENERATE_INPUT_FILE_COUNT[value.mode];
    if (value.inputFileCount !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['inputFileCount'],
        message: `mode ${value.mode} requires exactly ${expected} input file(s)`,
      });
    }
  });

export type ImageGenerateMode = z.infer<typeof imageGenerateModeEnum>;
export type ImageGenerateSize = z.infer<typeof imageGenerateSizeEnum>;
export type ImageGenerateQuality = z.infer<typeof imageGenerateQualityEnum>;
export type ImageGenerateStyle = z.infer<typeof imageGenerateStyleEnum>;
export type ImageGenerateTaskConfig = z.infer<
  typeof imageGenerateTaskConfigSchema
>;
