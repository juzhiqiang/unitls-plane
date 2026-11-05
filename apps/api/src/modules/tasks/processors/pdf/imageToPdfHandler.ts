import type { PdfOperationHandler } from './task.type';

export const imageToPdfHandler: PdfOperationHandler<'image_to_pdf'> = async (
  context,
  task
) => {
  const fileIds: string[] = task.inputFileIds ?? [];
  if (fileIds.length === 0) throw new Error('No input files specified');

  const config = task.inputConfig;

  const orderedIds: string[] = config.order ?? fileIds;

  const images: { buffer: Buffer; mimeType: string }[] = [];
  for (let i = 0; i < orderedIds.length; i++) {
    const file = await context.filesService.getById(
      orderedIds[i]!,
      task.userId ?? null
    );
    if (!file.mimeType.startsWith('image/')) {
      throw new Error(
        `INVALID_FILE_TYPE: File ${file.filename} is not an image`
      );
    }
    const buffer = await context.filesService.download(file.storageKey);
    images.push({ buffer, mimeType: file.mimeType });
    await context.reportProgress(
      Math.floor(((i + 1) / orderedIds.length) * 50)
    );
  }

  const pdfBuffer = await context.pdfService.imagesToPdf(images, {
    pageSize: config.pageSize ?? 'original',
    fit: config.fit ?? 'fit',
  });
  await context.reportProgress(85);

  return context.completeOutput(pdfBuffer, {
    filename: config.outputFilename ?? 'images.pdf',
    mimeType: 'application/pdf',
  });
};
