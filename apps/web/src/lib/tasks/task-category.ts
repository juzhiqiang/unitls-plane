import type { TaskType } from '@/hooks/api/use-tasks';

export type TaskTypeCategory = 'image' | 'pdf' | 'font';

export function getTaskTypeCategory(type: TaskType): TaskTypeCategory {
  switch (type) {
    case 'compress':
    case 'convert':
    case 'image_watermark':
    case 'image_id_photo':
    case 'image_generate':
      return 'image';
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
      return 'pdf';
    case 'font_convert':
      return 'font';
  }
}
