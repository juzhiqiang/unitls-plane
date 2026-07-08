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
  scale: z.number().min(0.5).max(3),
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
