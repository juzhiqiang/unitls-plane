'use client';

import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PdfPagePreviewImage } from './pdf-page-preview-image';

interface PdfResultPreviewProps {
  file: File;
  label: string;
}

export function PdfResultPreview({ file, label }: PdfResultPreviewProps) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPdf(null);
    setCanvas(null);
    setError(null);

    import('@/lib/processing/pdf-client')
      .then(async ({ loadPdf, renderPdfPage }) => {
        const doc = await loadPdf(file);
        const previewCanvas = await renderPdfPage(doc, 1, 0.45);
        if (!cancelled) {
          setPdf(doc);
          setCanvas(previewCanvas);
        }
      })
      .catch(err => {
        if (!cancelled) setError((err as Error).message);
      });

    return () => {
      cancelled = true;
    };
  }, [file]);

  return (
    <div className="rounded-md border border-border bg-muted/10 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs font-mono text-muted-foreground">
            {label}
          </span>
        </div>
        {pdf && (
          <span className="shrink-0 text-[10px] font-mono text-muted-foreground tabular-nums">
            {pdf.numPages}p
          </span>
        )}
      </div>
      <div className="flex min-h-[220px] items-center justify-center overflow-hidden rounded border border-border bg-background">
        {canvas ? (
          <PdfPagePreviewImage
            canvas={canvas}
            alt={label}
            className="max-h-[360px] w-auto object-contain"
          />
        ) : (
          <span className="text-xs font-mono text-muted-foreground">
            {error ?? '...'}
          </span>
        )}
      </div>
    </div>
  );
}
