import { z } from 'zod';

/**
 * 任务类型的单一来源。
 * 数据库 pgEnum（packages/db/src/schema/tasks.ts）与 DTO（tasks.dto.ts）
 * 都从这里取值，避免新增类型时漏改一处导致状态/分支不一致。
 * 顺序即 zod enum 顺序，新增类型只在此追加���
 */
export const TASK_TYPES = [
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
  'pdf_from_document',
  'image_generate',
] as const satisfies readonly string[];

export const taskTypeEnum = z.enum(TASK_TYPES);

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

export const TASK_STATUSES = [
  'pending',
  'processing',
  'completed',
  'failed',
] as const satisfies readonly string[];

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type TaskType = z.infer<typeof taskTypeEnum>;
export type TaskStatus = z.infer<typeof taskStatusEnum>;
