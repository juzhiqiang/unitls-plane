import type { PdfOperationHandler } from './task.type';

export const toTextHandler: PdfOperationHandler<'pdf_to_text'> = async (
  context,
  task
) => {
  const { file: inputFile, buffer: inputBuffer } = await context.readPdf(10);

  const config = task.inputConfig;

  const pageBreakMap = {
    hr: '\n\n---\n\n',
    newline: '\n\n',
    none: '',
  };
  const pageBreak = pageBreakMap[config.pageBreak ?? 'hr'] ?? '\n\n---\n\n';

  const result = await context.pdfService.toText(inputBuffer, {
    format: config.format ?? 'markdown',
    pages: config.pages,
    pageBreak,
  });
  await context.reportProgress(80);

  const ext = config.format === 'text' ? 'txt' : 'md';
  const baseName = inputFile.filename.replace(/\.pdf$/i, '');
  const outputBuffer = Buffer.from(result, 'utf-8');

  return context.completeOutput(
    outputBuffer,
    { filename: `${baseName}.${ext}`, mimeType: 'text/plain' },
    { afterUploadProgress: 95 }
  );
};
