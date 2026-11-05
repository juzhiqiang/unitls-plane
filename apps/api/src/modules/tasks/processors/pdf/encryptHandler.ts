import type { PdfOperationHandler } from './task.type';

export const encryptHandler: PdfOperationHandler<'pdf_encrypt'> = async (
  context,
  task
) => {
  const { file: inputFile, buffer: inputBuffer } = await context.readPdf(20);

  const config = task.inputConfig;
  if (!config.ownerPassword) {
    throw new Error('Owner password is required');
  }

  const result = await context.pdfService.encrypt(inputBuffer, {
    userPassword: config.userPassword,
    ownerPassword: config.ownerPassword,
    permissions: config.permissions,
  });
  await context.reportProgress(85);

  return context.completeOutput(result, {
    filename: `encrypted-${inputFile.filename}`,
    mimeType: 'application/pdf',
  });
};
