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
  const canvasRef = useRef<HTMLDivElement>(null);
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
      const canvas = await renderPdfPage(pdf, pageNumber, scale);
      if (cancelled || !canvasRef.current) return;
      canvasRef.current.innerHTML = '';
      canvas.className = 'w-full h-auto';
      canvasRef.current.appendChild(canvas);
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
      <div ref={canvasRef} className="min-h-[80px] flex items-center justify-center">
        {!loaded && (
          <div className="text-xs text-muted-foreground">加载中...</div>
        )}
      </div>
      <p className="text-xs text-center text-muted-foreground mt-1">
        {pageNumber}
      </p>
    </div>
  );
}
