import type { PdfOperationHandler } from './task.type';

export const compressHandler: PdfOperationHandler<'pdf_compress'> = async (
  context,
  task
) => {
  const { file: inputFile, buffer: inputBuffer } = await context.readPdf(10);
  const originalSize = inputBuffer.length;

  const config = task.inputConfig;
  const result = await context.pdfService.compressPdf(inputBuffer, {
    level: config.level ?? 'medium',
  });
  await context.reportProgress(85);

  const completed = await context.completeOutput(result, {
    filename: `compressed-${inputFile.filename}`,
    mimeType: 'application/pdf',
  });
  return { ...completed, originalSize, compressedSize: result.length };
};
