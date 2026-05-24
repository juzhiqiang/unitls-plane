'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { loadPdf, renderPdfPage } from '@/lib/processing/pdf-client';

interface PdfPreviewProps {
  file: File;
  scale?: number;
  maxConcurrent?: number;
}

export function PdfPreview({
  file,
  scale = 0.5,
  maxConcurrent = 3,
}: PdfPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pageCount, setPageCount] = useState(0);
  const [rendered, setRendered] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function render() {
      const pdf = await loadPdf(file);
      if (cancelled) return;
      setPageCount(pdf.numPages);

      if (!containerRef.current) return;
      containerRef.current.innerHTML = '';

      const queue: number[] = [];
      for (let i = 1; i <= pdf.numPages; i++) queue.push(i);

      let completed = 0;

      async function processPage(pageNum: number) {
        if (cancelled) return;
        const canvas = await renderPdfPage(pdf, pageNum, scale);
        if (cancelled) return;
        canvas.className = 'border rounded shadow-sm w-full';
        canvas.dataset.page = String(pageNum);

        const container = containerRef.current;
        if (!container) return;

        const existing = Array.from(container.children);
        let inserted = false;
        for (const child of existing) {
          const childPage = Number((child as HTMLElement).dataset.page);
          if (childPage > pageNum) {
            container.insertBefore(canvas, child);
            inserted = true;
            break;
          }
        }
        if (!inserted) container.appendChild(canvas);

        completed++;
        setRendered(completed);
      }

      async function worker() {
        while (queue.length > 0) {
          if (cancelled) return;
          const pageNum = queue.shift()!;
          await processPage(pageNum);
        }
      }

      const workers = Array.from(
        { length: Math.min(maxConcurrent, pdf.numPages) },
        () => worker()
      );
      await Promise.all(workers);
    }

    render();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [file, scale, maxConcurrent]);

  return (
    <div>
      <p className="text-sm text-muted-foreground">
        共 {pageCount} 页{pageCount > 0 && rendered < pageCount && ` (已渲染 ${rendered}/${pageCount})`}
      </p>
      <div ref={containerRef} className="grid grid-cols-3 gap-4 mt-4" />
    </div>
  );
}
