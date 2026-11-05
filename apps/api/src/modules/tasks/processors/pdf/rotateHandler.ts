import type { PdfOperationHandler } from './task.type';

export const rotateHandler: PdfOperationHandler<'pdf_rotate'> = async (
  context,
  task
) => {
  const { file: inputFile, buffer: inputBuffer } = await context.readPdf(20);

  const config = task.inputConfig;
  if (!Array.isArray(config.pages) || config.pages.length === 0) {
    throw new Error('At least one page must be selected');
  }

  const result = await context.pdfService.rotate(inputBuffer, {
    pages: config.pages,
    angle: config.angle,
  });
  await context.reportProgress(85);

  return context.completeOutput(result, {
    filename: `rotated-${inputFile.filename}`,
    mimeType: 'application/pdf',
  });
};
