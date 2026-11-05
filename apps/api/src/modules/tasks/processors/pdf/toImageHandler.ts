import type { PdfOperationHandler } from './task.type';
import { createZipArchive, streamToBuffer } from './zip-output';
import { getMupdf } from '../../services/pdf/mupdf-runtime';

export const toImageHandler: PdfOperationHandler<'pdf_to_image'> = async (
  context,
  task
) => {
  const { file: inputFile, buffer: inputBuffer } = await context.readPdf(10);

  const config = task.inputConfig;
  const format = config.format ?? 'png';
  const dpi = Math.min(Math.max(config.dpi ?? 150, 72), 600);
  const quality = Math.min(Math.max(config.quality ?? 85, 1), 100);
  const scale = dpi / 72;

  const mupdf = await getMupdf();
  const doc = mupdf.Document.openDocument(inputBuffer, 'application/pdf');
  const totalPages = doc.countPages();
  const pageIndices: number[] =
    config.pages ?? Array.from({ length: totalPages }, (_, i) => i);

  if (pageIndices.length === 0) {
    throw new Error('No pages selected for conversion');
  }

  const images: { name: string; data: Buffer }[] = [];

  for (let i = 0; i < pageIndices.length; i++) {
    const pageIdx = pageIndices[i]!;
    if (pageIdx < 0 || pageIdx >= totalPages) {
      throw new Error(
        `Invalid page index ${pageIdx}, total pages: ${totalPages}`
      );
    }

    const page = doc.loadPage(pageIdx);
    const pixmap = page.toPixmap(
      mupdf.Matrix.scale(scale, scale),
      mupdf.ColorSpace.DeviceRGB
    );

    let imageData: Buffer;
    const ext = format === 'jpeg' ? 'jpg' : 'png';

    if (format === 'jpeg') {
      imageData = Buffer.from(pixmap.asJPEG(quality));
    } else {
      imageData = Buffer.from(pixmap.asPNG());
    }

    images.push({
      name: `page-${pageIdx + 1}.${ext}`,
      data: imageData,
    });

    await context.reportProgress(
      10 + Math.floor(((i + 1) / pageIndices.length) * 70)
    );
  }

  let outputBuffer: Buffer;
  let outputName: string;
  let outputMime: string;

  const baseName = inputFile.filename.replace(/\.pdf$/i, '');

  if (images.length === 1) {
    outputBuffer = images[0]!.data;
    outputName = `${baseName}.${format === 'jpeg' ? 'jpg' : 'png'}`;
    outputMime = `image/${format}`;
  } else {
    const archive = createZipArchive();
    for (const img of images) {
      archive.append(img.data, { name: img.name });
    }
    outputBuffer = await streamToBuffer(archive);
    outputName = `${baseName}-images.zip`;
    outputMime = 'application/zip';
  }
  await context.reportProgress(90);

  return context.completeOutput(outputBuffer, {
    filename: outputName,
    mimeType: outputMime,
  });
};
