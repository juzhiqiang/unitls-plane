import { z } from 'zod';

export const taskTypeEnum = z.enum([
  'compress',
  'convert',
  'pdf_merge',
  'pdf_split',
  'font_convert',
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
