import type { PdfOperationHandler } from './task.type';

export const rearrangeHandler: PdfOperationHandler<'pdf_rearrange'> = async (
  context,
  task
) => {
  const { file: inputFile, buffer: inputBuffer } = await context.readPdf(20);

  const config = task.inputConfig;
  if (!Array.isArray(config.pageOrder) || config.pageOrder.length === 0) {
    throw new Error('Page order must not be empty');
  }

  const result = await context.pdfService.rearrange(inputBuffer, {
    pageOrder: config.pageOrder,
  });
  await context.reportProgress(85);

  return context.completeOutput(result, {
    filename: `rearranged-${inputFile.filename}`,
    mimeType: 'application/pdf',
  });
};
