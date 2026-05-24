'use client';

import { useEffect, useRef, useState } from 'react';
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
  const [pageCount, setPageCount] = useState(0);
  const [rendered, setRendered] = useState(0);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());

  useEffect(() => {
    let cancelled = false;
    canvasRefs.current = new Map();
    setPageCount(0);
    setRendered(0);

    async function render() {
      const pdf = await loadPdf(file);
      if (cancelled) return;
      setPageCount(pdf.numPages);

      // wait one frame so React commits the canvas elements before we paint into them
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (cancelled) return;

      const queue: number[] = [];
      for (let i = 1; i <= pdf.numPages; i++) queue.push(i);

      let completed = 0;

      async function processPage(pageNum: number) {
        if (cancelled) return;
        const canvas = canvasRefs.current.get(pageNum);
        if (!canvas) return;
        await renderPdfPage(pdf, pageNum, scale, canvas);
        if (cancelled) return;
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
    };
  }, [file, scale, maxConcurrent]);

  return (
    <div>
      <p className="text-sm text-muted-foreground">
        共 {pageCount} 页{pageCount > 0 && rendered < pageCount && ` (已渲染 ${rendered}/${pageCount})`}
      </p>
      <div className="grid grid-cols-3 gap-4 mt-4">
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((pageNum) => (
          <canvas
            key={pageNum}
            ref={(el) => {
              if (el) canvasRefs.current.set(pageNum, el);
              else canvasRefs.current.delete(pageNum);
            }}
            className="border rounded shadow-sm w-full"
          />
        ))}
      </div>
    </div>
  );
}
