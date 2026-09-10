'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PdfPagePreviewImage } from './pdf-page-preview-image';
import { usePdfThumbnailWindow } from './use-pdf-thumbnail-window';

type RenderPdfPage =
  (typeof import('@/lib/processing/pdf-client'))['renderPdfPage'];

interface PdfResultPreviewProps {
  file: File;
  label: string;
  previousLabel: string;
  nextLabel: string;
  pageIndicator: (page: number, total: number) => string;
  thumbnailLabel: (page: number) => string;
  loadingLabel: string;
}

function destroyPdf(pdf: PDFDocumentProxy | null) {
  if (!pdf) return;
  try {
    void Promise.resolve(pdf.destroy()).catch(() => undefined);
  } catch {
    // PDF.js cleanup failures must not interfere with replacing the preview.
  }
}

export function PdfResultPreview({
  file,
  label,
  previousLabel,
  nextLabel,
  pageIndicator,
  thumbnailLabel,
  loadingLabel,
}: PdfResultPreviewProps) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [mainCanvas, setMainCanvas] = useState<HTMLCanvasElement | null>(null);
  const [thumbnails, setThumbnails] = useState<
    Record<number, HTMLCanvasElement>
  >({});
  const [thumbnailErrors, setThumbnailErrors] = useState<
    Record<number, string>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const activePdfRef = useRef<PDFDocumentProxy | null>(null);
  const renderPdfPageRef = useRef<RenderPdfPage | null>(null);
  const thumbnailWorkRef = useRef<Promise<unknown>>(Promise.resolve());
  const window = usePdfThumbnailWindow(pdf?.numPages ?? 0, currentPage, file);

  useEffect(() => {
    let cancelled = false;
    setPdf(null);
    setCurrentPage(1);
    setMainCanvas(null);
    setThumbnails({});
    setThumbnailErrors({});
    setError(null);
    setLoading(true);
    renderPdfPageRef.current = null;
    thumbnailWorkRef.current = Promise.resolve();

    const previousPdf = activePdfRef.current;
    activePdfRef.current = null;
    destroyPdf(previousPdf);

    import('@/lib/processing/pdf-client')
      .then(async ({ loadPdf, renderPdfPage }) => {
        const loadedPdf = await loadPdf(file);
        if (cancelled) {
          destroyPdf(loadedPdf);
          return;
        }
        renderPdfPageRef.current = renderPdfPage;
        activePdfRef.current = loadedPdf;
        setPdf(loadedPdf);
        setLoading(false);
      })
      .catch(err => {
        if (!cancelled) {
          setError((err as Error).message);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      const currentPdf = activePdfRef.current;
      activePdfRef.current = null;
      renderPdfPageRef.current = null;
      destroyPdf(currentPdf);
    };
  }, [file]);

  useEffect(() => {
    const renderPdfPage = renderPdfPageRef.current;
    if (!pdf || !renderPdfPage) return;
    let cancelled = false;
    setMainCanvas(null);
    let renderedCanvas: HTMLCanvasElement | null = null;

    Promise.resolve()
      .then(() => renderPdfPage(pdf, currentPage, 0.7))
      .then(canvas => {
        if (!cancelled) {
          renderedCanvas = canvas;
          setMainCanvas(canvas);
        } else {
          canvas.width = 0;
          canvas.height = 0;
        }
      })
      .catch(err => {
        if (!cancelled) setError((err as Error).message);
      });

    return () => {
      cancelled = true;
      if (renderedCanvas) {
        renderedCanvas.width = 0;
        renderedCanvas.height = 0;
      }
    };
  }, [pdf, currentPage]);

  useEffect(() => {
    const renderPdfPage = renderPdfPageRef.current;
    if (!pdf || !renderPdfPage) return;
    let cancelled = false;
    let nextPage = window.start;
    const nextThumbnails: Record<number, HTMLCanvasElement> = {};
    const nextThumbnailErrors: Record<number, string> = {};

    setThumbnails({});
    setThumbnailErrors({});

    const renderNext = async () => {
      while (!cancelled) {
        const page = nextPage++;
        if (page > window.end) return;
        try {
          const canvas = await renderPdfPage(pdf, page, 0.2);
          if (!cancelled) {
            nextThumbnails[page] = canvas;
          } else {
            canvas.width = 0;
            canvas.height = 0;
          }
        } catch (err) {
          if (!cancelled) {
            nextThumbnailErrors[page] = (err as Error).message;
          }
        }
      }
    };

    const previousWork = thumbnailWorkRef.current;
    const work = previousWork
      .then(() =>
        Promise.all(
          Array.from({ length: Math.min(3, pdf.numPages) }, () => renderNext())
        )
      )
      .then(() => {
        if (!cancelled) {
          setThumbnails(nextThumbnails);
          setThumbnailErrors(nextThumbnailErrors);
        }
      });
    thumbnailWorkRef.current = work;

    return () => {
      cancelled = true;
      Object.values(nextThumbnails).forEach(canvas => {
        canvas.width = 0;
        canvas.height = 0;
      });
    };
  }, [pdf, window.start, window.end]);

  const totalPages = pdf?.numPages ?? 0;
  const mainPlaceholder = loading ? loadingLabel : (error ?? loadingLabel);

  return (
    <div className="rounded-md border border-border bg-muted/10 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs font-mono text-muted-foreground">
            {label}
          </span>
        </div>
        {pdf && (
          <span className="shrink-0 text-[10px] font-mono tabular-nums text-muted-foreground">
            {totalPages}p
          </span>
        )}
      </div>

      <div className="max-h-[560px] overflow-auto rounded border border-border bg-background p-2">
        <div className="flex min-h-[220px] items-center justify-center">
          {mainCanvas ? (
            <PdfPagePreviewImage
              canvas={mainCanvas}
              alt={pdf ? pageIndicator(currentPage, totalPages) : label}
              className="mx-auto h-auto max-h-[520px] max-w-full w-auto object-contain"
            />
          ) : (
            <span className="text-xs font-mono text-muted-foreground">
              {mainPlaceholder}
            </span>
          )}
        </div>
      </div>

      {pdf && (
        <>
          <div className="mt-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setCurrentPage(page => Math.max(1, page - 1))}
              disabled={currentPage <= 1}
              className="inline-flex items-center gap-1 text-xs font-mono text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
              aria-label={previousLabel}
              title={previousLabel}
            >
              <ChevronLeft className="h-4 w-4" />
              {previousLabel}
            </button>
            <span className="text-xs font-mono tabular-nums text-muted-foreground">
              {pageIndicator(currentPage, totalPages)}
            </span>
            <button
              type="button"
              onClick={() =>
                setCurrentPage(page => Math.min(totalPages, page + 1))
              }
              disabled={currentPage >= totalPages}
              className="inline-flex items-center gap-1 text-xs font-mono text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
              aria-label={nextLabel}
              title={nextLabel}
            >
              {nextLabel}
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div
            ref={window.ref}
            onScroll={window.onScroll}
            data-testid="pdf-thumbnail-scroll"
            className="mt-3 max-h-[360px] overflow-y-auto"
          >
            <div style={{ height: window.before }} />
            <div
              className="grid gap-x-2"
              style={{
                gridTemplateColumns: `repeat(${window.columns}, minmax(0, 1fr))`,
                gridAutoRows: '128px',
              }}
            >
              {Array.from(
                { length: Math.max(0, window.end - window.start + 1) },
                (_, index) => index + window.start
              ).map(page => {
                const thumbnail = thumbnails[page];
                const thumbnailError = thumbnailErrors[page];
                const labelForPage = thumbnailLabel(page);
                return (
                  <button
                    key={page}
                    type="button"
                    onClick={() => setCurrentPage(page)}
                    className={`mb-2 flex min-h-20 overflow-hidden items-center justify-center rounded border p-1 transition-colors ${
                      currentPage === page
                        ? 'border-foreground bg-muted'
                        : 'border-border hover:border-foreground/60'
                    }`}
                    aria-label={labelForPage}
                    title={labelForPage}
                    aria-current={currentPage === page ? 'page' : undefined}
                  >
                    {thumbnail ? (
                      <PdfPagePreviewImage
                        canvas={thumbnail}
                        alt={labelForPage}
                        className="h-auto max-h-full max-w-full w-auto object-contain"
                      />
                    ) : (
                      <span className="px-1 text-center text-[10px] font-mono text-muted-foreground">
                        {thumbnailError ? labelForPage : loadingLabel}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div style={{ height: window.after }} />
          </div>
        </>
      )}
    </div>
  );
}
