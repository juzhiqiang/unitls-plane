import type { PdfOperationHandler } from './task.type';
import { createZipArchive, streamToBuffer } from './zip-output';

export const splitHandler: PdfOperationHandler<'pdf_split'> = async (
  context,
  task
) => {
  const { file: inputFile, buffer: inputBuffer } = await context.readPdf(20);

  const opts = task.inputConfig;
  const outputs = await context.pdfService.split(inputBuffer, opts);
  await context.reportProgress(60);

  let outputBuffer: Buffer;
  let outputName: string;
  let outputMime: string;

  if (outputs.length === 1) {
    outputBuffer = outputs[0]!;
    outputName = `split-${inputFile.filename}`;
    outputMime = 'application/pdf';
  } else {
    const archive = createZipArchive();
    outputs.forEach((buf, i) => {
      archive.append(buf, { name: `part-${i + 1}.pdf` });
    });
    outputBuffer = await streamToBuffer(archive);
    const baseName = inputFile.filename.replace(/\.pdf$/i, '');
    outputName = `split-${baseName}.zip`;
    outputMime = 'application/zip';
  }
  await context.reportProgress(85);

  return context.completeOutput(outputBuffer, {
    filename: outputName,
    mimeType: outputMime,
  });
};
