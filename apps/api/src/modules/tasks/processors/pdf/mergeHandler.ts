import type { PdfOperationHandler } from './task.type';

const MAX_TOTAL_PAGES = 500;
const MAX_FILE_SIZE = 50 * 1024 * 1024;

export const mergeHandler: PdfOperationHandler<'pdf_merge'> = async (
  context,
  task
) => {
  const config = task.inputConfig;
  const orderedIds = config.order ?? task.inputFileIds;

  if (!orderedIds || orderedIds.length === 0) {
    throw new Error('No input files specified');
  }

  const inputs: Buffer[] = [];
  let totalPages = 0;

  for (let i = 0; i < orderedIds.length; i++) {
    const file = await context.filesService.getById(
      orderedIds[i]!,
      task.userId ?? null
    );

    if (file.mimeType !== 'application/pdf') {
      throw new Error(`INVALID_FILE_TYPE: File ${file.filename} is not a PDF`);
    }

    if (file.originalSize > MAX_FILE_SIZE) {
      throw new Error(`File ${file.filename} exceeds 50MB limit`);
    }

    const buffer = await context.filesService.download(file.storageKey);
    const pageCount = await context.pdfService.getPageCount(buffer);
    totalPages += pageCount;

    if (totalPages > MAX_TOTAL_PAGES) {
      throw new Error(
        `Total page count (${totalPages}) exceeds limit of ${MAX_TOTAL_PAGES}`
      );
    }

    inputs.push(buffer);
    await context.reportProgress(
      Math.floor(((i + 1) / orderedIds.length) * 40)
    );
  }

  const merged = await context.pdfService.merge(inputs);
  await context.reportProgress(80);

  return context.completeOutput(
    merged,
    {
      filename: config.outputFilename ?? 'merged.pdf',
      mimeType: 'application/pdf',
    },
    { afterUploadProgress: 95 }
  );
};
