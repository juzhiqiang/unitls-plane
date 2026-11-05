import type { PdfOperationHandler } from './task.type';

export const watermarkHandler: PdfOperationHandler<'pdf_watermark'> = async (
  context,
  task
) => {
  const { file: inputFile, buffer: inputBuffer } = await context.readPdf(20);

  const config = task.inputConfig;
  if (!config.text || config.text.trim().length === 0) {
    throw new Error('Watermark text is required');
  }

  const result = await context.pdfService.watermark(inputBuffer, {
    text: config.text,
    fontSize: config.fontSize,
    opacity: config.opacity,
    color: config.color,
    rotation: config.rotation,
    position: config.position,
  });
  await context.reportProgress(85);

  return context.completeOutput(result, {
    filename: `watermarked-${inputFile.filename}`,
    mimeType: 'application/pdf',
  });
};
