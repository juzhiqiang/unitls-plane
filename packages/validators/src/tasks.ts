import { z } from 'zod';

export const taskTypeEnum = z.enum([
  'compress',
  'convert',
  'image_watermark',
  'image_id_photo',
  'pdf_merge',
  'pdf_split',
  'pdf_to_image',
  'font_convert',
  'pdf_to_text',
  'image_to_pdf',
  'pdf_rotate',
  'pdf_watermark',
  'pdf_encrypt',
  'pdf_compress',
  'pdf_metadata',
  'pdf_rearrange',
]);

export const createTaskSchema = z.object({
  type: taskTypeEnum,
  inputFileIds: z.array(z.string().uuid()).min(1),
  inputConfig: z.record(z.unknown()),
});

export const taskStatusEnum = z.enum([
  'pending',
  'processing',
  'completed',
  'failed',
]);

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type TaskType = z.infer<typeof taskTypeEnum>;
export type TaskStatus = z.infer<typeof taskStatusEnum>;
