import type { PdfOperationHandler } from './task.type';
import type { DocumentToPdfOptions } from '../../services/pdf.service';

const MAX_FILE_SIZE = 50 * 1024 * 1024;

function inferDocumentFormat(
  filename: string,
  mimeType: string | null | undefined
): DocumentToPdfOptions['sourceFormat'] | null {
  const lowerName = filename.toLowerCase();
  if (
    lowerName.endsWith('.md') ||
    lowerName.endsWith('.markdown') ||
    mimeType === 'text/markdown'
  ) {
    return 'markdown';
  }
  if (
    lowerName.endsWith('.docx') ||
    mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx';
  }
  if (mimeType === 'text/plain') {
    return 'markdown';
  }
  return null;
}

function normalizePdfFilename(
  filename: string | undefined,
  fallback: string
): string {
  const value = (filename ?? fallback).trim();
  const withExt = value.toLowerCase().endsWith('.pdf') ? value : `${value}.pdf`;
  // eslint-disable-next-line no-control-regex -- Intentionally strips ASCII control characters from PDF filenames.
  return withExt.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') || fallback;
}

export const documentToPdfHandler: PdfOperationHandler<
  'pdf_from_document'
> = async (context, task) => {
  const fileId = task.inputFileIds?.[0];
  if (!fileId) throw new Error('No input file specified');

  const inputFile = await context.filesService.getById(
    fileId,
    task.userId ?? null
  );
  const inputBuffer = await context.filesService.download(inputFile.storageKey);
  await context.reportProgress(20);

  const config = task.inputConfig;
  const sourceFormat =
    config.sourceFormat ??
    inferDocumentFormat(inputFile.filename, inputFile.mimeType);

  if (!sourceFormat) {
    throw new Error(
      `INVALID_FILE_TYPE: File ${inputFile.filename} is not Markdown or Word`
    );
  }

  if (inputFile.originalSize > MAX_FILE_SIZE) {
    throw new Error(`File ${inputFile.filename} exceeds 50MB limit`);
  }

  const result = await context.pdfService.documentToPdf(
    {
      buffer: inputBuffer,
      filename: inputFile.filename,
      mimeType: inputFile.mimeType,
    },
    {
      sourceFormat,
    } satisfies DocumentToPdfOptions
  );
  await context.reportProgress(85);

  const baseName = inputFile.filename.replace(/\.(md|markdown|docx)$/i, '');
  const outputName = normalizePdfFilename(
    config.outputFilename,
    `${baseName}.pdf`
  );
  return context.completeOutput(result, {
    filename: outputName,
    mimeType: 'application/pdf',
  });
};
