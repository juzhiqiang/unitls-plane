import type { TaskType } from '@utils-plane/validators';

export type TaskQueueName =
  | 'image-queue'
  | 'pdf-queue'
  | 'font-queue'
  | 'ai-queue';

export function getTaskQueueName(type: TaskType): TaskQueueName {
  switch (type) {
    case 'compress':
    case 'convert':
    case 'image_watermark':
    case 'image_id_photo':
      return 'image-queue';
    case 'pdf_merge':
    case 'pdf_split':
    case 'pdf_to_image':
    case 'pdf_to_text':
    case 'image_to_pdf':
    case 'pdf_rotate':
    case 'pdf_watermark':
    case 'pdf_encrypt':
    case 'pdf_compress':
    case 'pdf_metadata':
    case 'pdf_rearrange':
    case 'pdf_from_document':
      return 'pdf-queue';
    case 'font_convert':
      return 'font-queue';
    case 'image_generate':
      return 'ai-queue';
  }
}

/**
 * 每个队列允许的 attempt 次数(含第一次)。
 *
 * ai-queue 只给一次重试:生图的每一次 attempt 都是一条真实计费的上游请求,而且上游
 * 网关偶发 502/超时时那张图往往已经出图并计费了,重试拿到的是新的一张。一次重试足够
 * 盖住瞬时抖动,再多就是替用户花钱。确定性失败(内容策略拒绝等)由 processor 直接
 * 掐断,不会用到这里的次数。
 *
 * 其余队列是本机 CPU 活,重试只花自己的时间,保持 3 次。
 */
const QUEUE_ATTEMPTS: Record<TaskQueueName, number> = {
  'image-queue': 3,
  'pdf-queue': 3,
  'font-queue': 3,
  'ai-queue': 2,
};

export function getTaskQueueAttempts(queueName: string): number {
  return QUEUE_ATTEMPTS[queueName as TaskQueueName] ?? 3;
}
