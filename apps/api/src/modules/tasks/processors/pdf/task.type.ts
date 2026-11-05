import type { Task } from '@utils-plane/db';
import type { Job } from 'bullmq';
import type { PdfToCadConversionMeta } from '@utils-plane/validators';
import type {
  SplitOptions,
  ImageToPdfOptions,
  RotateOptions,
  WatermarkOptions,
  EncryptOptions,
  CompressPdfOptions,
  PdfMetadata,
  RearrangeOptions,
  DocumentToPdfOptions,
} from '../../services/pdf.service';
import type { PdfTaskContext } from './task-context';

export interface PdfTaskConfigs {
  pdf_merge: { order?: string[]; outputFilename?: string };
  pdf_split: SplitOptions;
  pdf_to_image: {
    format?: 'png' | 'jpeg';
    dpi?: number;
    quality?: number;
    pages?: number[];
  };
  pdf_to_text: {
    format?: 'markdown' | 'text';
    pages?: number[];
    pageBreak?: 'hr' | 'newline' | 'none';
  };
  image_to_pdf: ImageToPdfOptions & {
    order?: string[];
    outputFilename?: string;
  };
  pdf_rotate: RotateOptions;
  pdf_watermark: WatermarkOptions;
  pdf_encrypt: EncryptOptions;
  pdf_compress: Partial<CompressPdfOptions>;
  pdf_metadata: PdfMetadata;
  pdf_rearrange: RearrangeOptions;
  pdf_from_document: {
    sourceFormat?: DocumentToPdfOptions['sourceFormat'];
    outputFilename?: string;
  };
  pdf_to_cad: unknown;
}

export type PdfTaskType = keyof PdfTaskConfigs;
export type PdfTaskFor<K extends PdfTaskType> = Pick<
  Task,
  'id' | 'userId' | 'inputFileIds'
> & {
  type: K;
  inputConfig: PdfTaskConfigs[K];
};
export type PdfTask = { [K in PdfTaskType]: PdfTaskFor<K> }[PdfTaskType];
export type PdfJob = Job<{ taskId: string }>;
export interface PdfTaskResult {
  outputFileId: string;
  originalSize?: number;
  compressedSize?: number;
  meta?: PdfToCadConversionMeta;
}
export type PdfOperationHandler<K extends PdfTaskType> = (
  context: PdfTaskContext,
  task: PdfTaskFor<K>
) => Promise<PdfTaskResult>;
