import type { PDFDocumentProxy } from 'pdfjs-dist';

type PdfJs = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfJs> | null = null;

async function getPdfJs(): Promise<PdfJs> {
  if (typeof window === 'undefined') {
    throw new Error('PDF rendering is only available in the browser.');
  }

  pdfjsPromise ??= import('pdfjs-dist').then((pdfjsLib) => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    return pdfjsLib;
  });

  return pdfjsPromise;
}

export async function loadPdf(
  file: File | Blob
): Promise<PDFDocumentProxy> {
  const pdfjsLib = await getPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  return pdfjsLib.getDocument({ data: arrayBuffer }).promise;
}

export async function renderPdfPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  scale: number = 1,
  targetCanvas?: HTMLCanvasElement
): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  const canvas = targetCanvas ?? document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  await page.render({ canvas, viewport }).promise;
  return canvas;
}
