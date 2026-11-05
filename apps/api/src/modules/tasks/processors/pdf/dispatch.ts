import type { Task } from '@utils-plane/db';
import type { PdfTaskContext } from './task-context';
import type { PdfTask, PdfTaskResult } from './task.type';
import { mergeHandler } from './mergeHandler';
import { splitHandler } from './splitHandler';
import { toImageHandler } from './toImageHandler';
import { toTextHandler } from './toTextHandler';
import { imageToPdfHandler } from './imageToPdfHandler';
import { documentToPdfHandler } from './documentToPdfHandler';
import { rotateHandler } from './rotateHandler';
import { watermarkHandler } from './watermarkHandler';
import { encryptHandler } from './encryptHandler';
import { compressHandler } from './compressHandler';
import { metadataHandler } from './metadataHandler';
import { toCadHandler } from './toCadHandler';
import { rearrangeHandler } from './rearrangeHandler';

/** 数据库保留原任务协议；按 type 收窄配置后交给具体操作。 */
export function dispatchPdfTask(
  task: Task,
  context: PdfTaskContext
): Promise<PdfTaskResult> {
  const pdfTask = task as PdfTask;
  switch (pdfTask.type) {
    case 'pdf_merge':
      return mergeHandler(context, pdfTask);
    case 'pdf_split':
      return splitHandler(context, pdfTask);
    case 'pdf_to_image':
      return toImageHandler(context, pdfTask);
    case 'pdf_to_text':
      return toTextHandler(context, pdfTask);
    case 'image_to_pdf':
      return imageToPdfHandler(context, pdfTask);
    case 'pdf_from_document':
      return documentToPdfHandler(context, pdfTask);
    case 'pdf_rotate':
      return rotateHandler(context, pdfTask);
    case 'pdf_watermark':
      return watermarkHandler(context, pdfTask);
    case 'pdf_encrypt':
      return encryptHandler(context, pdfTask);
    case 'pdf_compress':
      return compressHandler(context, pdfTask);
    case 'pdf_metadata':
      return metadataHandler(context, pdfTask);
    case 'pdf_to_cad':
      return toCadHandler(context, pdfTask);
    case 'pdf_rearrange':
      return rearrangeHandler(context, pdfTask);
    default:
      throw new Error(`Unknown pdf task type: ${task.type}`);
  }
}
