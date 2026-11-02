import { z } from 'zod';
import {
  IMAGE_GENERATE_MAX_REFERENCE_IMAGES,
  IMAGE_GENERATE_PROMPT_MAX_LENGTH,
  imageGenerateModelSchema,
  imageGenerateQualityEnum,
  imageGenerateSizeSchema,
} from './image-generate';

const tryOnReferenceBindingSchema = z.union([
  z.object({
    role: z.literal('person'),
    source: z.literal('upload'),
    inputIndex: z.number().int().min(0),
  }),
  z.object({
    role: z.literal('person'),
    source: z.literal('library'),
    assetId: z.string().uuid(),
  }),
  z.object({
    role: z.literal('garment'),
    source: z.literal('upload'),
    inputIndex: z.number().int().min(0),
  }),
  z.object({
    role: z.literal('garment'),
    source: z.literal('library'),
    assetId: z.string().uuid(),
  }),
  z.object({
    role: z.literal('pose'),
    source: z.literal('library'),
    assetId: z.string().uuid(),
  }),
  z.object({
    role: z.literal('style'),
    source: z.literal('library'),
    assetId: z.string().uuid(),
  }),
]);

export const imageTryOnModeEnum = z.enum(['product', 'inspiration']);

export const imageTryOnTaskConfigSchema = z
  .object({
    mode: imageTryOnModeEnum,
    references: z
      .array(tryOnReferenceBindingSchema)
      .min(2)
      .max(IMAGE_GENERATE_MAX_REFERENCE_IMAGES),
    promptAddition: z
      .string()
      .trim()
      .max(IMAGE_GENERATE_PROMPT_MAX_LENGTH)
      .optional(),
    size: imageGenerateSizeSchema.default('1024x1024'),
    quality: imageGenerateQualityEnum.default('high'),
    model: imageGenerateModelSchema.optional(),
    /** Processor-supplied count of task.inputFileIds; never accepted from clients. */
    inputFileCount: z
      .number()
      .int()
      .min(0)
      .max(IMAGE_GENERATE_MAX_REFERENCE_IMAGES),
  })
  .superRefine((value, ctx) => {
    const roles = value.references.map(reference => reference.role);
    const duplicateRoles = roles.filter(
      (role, index) => roles.indexOf(role) !== index
    );

    if (duplicateRoles.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['references'],
        message: 'Each reference role may only be provided once',
      });
    }

    const person = value.references.find(
      reference => reference.role === 'person'
    );
    const garment = value.references.find(
      reference => reference.role === 'garment'
    );

    if (!person || !garment) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['references'],
        message: 'A person and a garment reference are required',
      });
    }

    if (value.mode === 'product' && garment?.source !== 'upload') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['references'],
        message: 'Product mode requires an uploaded garment reference',
      });
    }

    if (value.mode === 'inspiration' && garment?.source !== 'library') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['references'],
        message: 'Inspiration mode requires a library garment reference',
      });
    }

    const uploadIndexes = value.references.flatMap(reference =>
      reference.source === 'upload' ? [reference.inputIndex] : []
    );
    if (new Set(uploadIndexes).size !== uploadIndexes.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['references'],
        message: 'An uploaded file may only be bound once',
      });
    }

    if (
      uploadIndexes.length !== value.inputFileCount ||
      uploadIndexes.some(index => index >= value.inputFileCount)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['references'],
        message:
          'Every uploaded input file must have one valid reference binding',
      });
    }
  });

export type ImageTryOnMode = z.infer<typeof imageTryOnModeEnum>;
export type ImageTryOnReferenceBinding = z.infer<
  typeof tryOnReferenceBindingSchema
>;
export type ImageTryOnTaskConfig = z.infer<typeof imageTryOnTaskConfigSchema>;
