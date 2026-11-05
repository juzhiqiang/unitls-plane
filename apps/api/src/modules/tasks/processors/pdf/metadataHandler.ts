import type { PdfOperationHandler } from './task.type';

export const metadataHandler: PdfOperationHandler<'pdf_metadata'> = async (
  context,
  task
) => {
  const { file: inputFile, buffer: inputBuffer } = await context.readPdf(20);

  const config = task.inputConfig;

  const result = await context.pdfService.editMetadata(inputBuffer, config);
  await context.reportProgress(85);

  return context.completeOutput(result, {
    filename: inputFile.filename,
    mimeType: 'application/pdf',
  });
};
