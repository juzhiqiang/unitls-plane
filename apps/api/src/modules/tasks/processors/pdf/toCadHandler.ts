import type { PdfOperationHandler } from './task.type';
import {
  PDF_TO_CAD_MAX_FILE_SIZE,
  PDF_TO_CAD_MAX_PAGES,
  pdfToCadTaskConfigSchema,
} from '@utils-plane/validators';
import type { ConversionStage } from '../../services/cad/pdf-to-cad.service';
import { CadError } from '../../services/cad/types';

const CAD_STAGE_PROGRESS: Record<ConversionStage, [number, number]> = {
  parse: [5, 50],
  ocr: [50, 80],
  write: [80, 90],
};

export const toCadHandler: PdfOperationHandler<'pdf_to_cad'> = async (
  context,
  task
) => {
  const fileId = task.inputFileIds?.[0];
  if (!fileId) {
    throw new CadError('CAD_INVALID_CONFIG', 'No input file specified');
  }

  const parsed = pdfToCadTaskConfigSchema.safeParse(task.inputConfig ?? {});
  if (!parsed.success) {
    throw new CadError(
      'CAD_INVALID_CONFIG',
      `Invalid PDF to CAD config: ${parsed.error.issues
        .map(issue => `${issue.path.join('.') || 'config'}: ${issue.message}`)
        .join('; ')}`,
      { issues: parsed.error.issues.map(issue => issue.path.join('.')) }
    );
  }
  const config = parsed.data;

  const inputFile = await context.filesService.getById(
    fileId,
    task.userId ?? null
  );
  if (inputFile.mimeType !== 'application/pdf') {
    throw new CadError(
      'CAD_INVALID_CONFIG',
      `INVALID_FILE_TYPE: File ${inputFile.filename} is not a PDF`
    );
  }
  if (inputFile.originalSize > PDF_TO_CAD_MAX_FILE_SIZE) {
    throw new CadError(
      'CAD_INVALID_CONFIG',
      `File ${inputFile.filename} exceeds ${PDF_TO_CAD_MAX_FILE_SIZE / 1024 / 1024}MB limit`
    );
  }

  const inputBuffer = await context.filesService.download(inputFile.storageKey);
  let pageCount: number;
  try {
    pageCount = await context.pdfService.getPageCount(inputBuffer);
  } catch (err) {
    throw new CadError(
      'CAD_CONVERSION_FAILED',
      `Unable to read PDF: ${(err as Error).message}`
    );
  }
  if (pageCount > PDF_TO_CAD_MAX_PAGES) {
    throw new CadError(
      'CAD_INVALID_CONFIG',
      `PDF has ${pageCount} pages, exceeding the limit of ${PDF_TO_CAD_MAX_PAGES}`,
      { pageCount, limit: PDF_TO_CAD_MAX_PAGES }
    );
  }
  await context.reportProgress(5);

  const result = await context.pdfToCadService.convert(inputBuffer, config, {
    baseName: inputFile.filename.replace(/\.pdf$/i, ''),
    onProgress: async (stage, fraction) => {
      const [from, to] = CAD_STAGE_PROGRESS[stage];
      await context.reportProgress(
        Math.round(from + (to - from) * Math.min(1, Math.max(0, fraction)))
      );
    },
  });
  await context.reportProgress(90);

  return context.completeOutput(
    result.output.data,
    { filename: result.output.filename, mimeType: result.output.mimeType },
    { afterUploadProgress: 95, meta: result.meta }
  );
};
