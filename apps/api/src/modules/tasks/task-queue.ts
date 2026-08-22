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
