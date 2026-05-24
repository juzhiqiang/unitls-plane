'use client';

import { useEffect, useRef, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { renderPdfPage } from '@/lib/processing/pdf-client';
import { cn } from '@/lib/utils';
import type { PDFDocumentProxy } from 'pdfjs-dist';

interface PdfPageCardProps {
  id: string;
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale?: number;
  selected?: boolean;
  onSelect?: (pageNumber: number, selected: boolean) => void;
}

export function PdfPageCard({
  id,
  pdf,
  pageNumber,
  scale = 0.3,
  selected = false,
  onSelect,
}: PdfPageCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  useEffect(() => {
    let cancelled = false;

    async function render() {
      if (!canvasRef.current) return;
      await renderPdfPage(pdf, pageNumber, scale, canvasRef.current);
      if (cancelled) return;
      setLoaded(true);
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [pdf, pageNumber, scale]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'relative border rounded-md p-2 cursor-grab bg-background',
        'transition-shadow hover:shadow-md',
        isDragging && 'opacity-50 shadow-lg',
        selected && 'ring-2 ring-primary'
      )}
      {...attributes}
      {...listeners}
    >
      <label className="absolute top-1 left-1 z-10 flex items-center gap-1">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect?.(pageNumber, e.target.checked)}
          className="h-4 w-4 rounded border-border"
          onClick={(e) => e.stopPropagation()}
        />
      </label>
      <div className="relative min-h-[80px] flex items-center justify-center">
        <canvas ref={canvasRef} className={cn('w-full h-auto', !loaded && 'invisible')} />
        {!loaded && (
          <div className="absolute text-xs text-muted-foreground">加载中...</div>
        )}
      </div>
      <p className="text-xs text-center text-muted-foreground mt-1">
        {pageNumber}
      </p>
    </div>
  );
}
