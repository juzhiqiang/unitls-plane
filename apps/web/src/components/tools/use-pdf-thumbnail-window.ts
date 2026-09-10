'use client';

import { useEffect, useRef, useState } from 'react';

export const PDF_THUMBNAIL_ROW_HEIGHT = 128;
export function usePdfThumbnailWindow(
  total: number,
  selected: number,
  identity: unknown
) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [columns, setColumns] = useState(3);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () =>
      setColumns(
        Math.max(3, Math.min(6, Math.floor(element.clientWidth / 110)))
      );
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [total]);
  useEffect(() => {
    setTop(0);
    if (ref.current) ref.current.scrollTop = 0;
  }, [identity]);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const rowTop =
      Math.floor((selected - 1) / columns) * PDF_THUMBNAIL_ROW_HEIGHT;
    if (
      rowTop < element.scrollTop ||
      rowTop + PDF_THUMBNAIL_ROW_HEIGHT > element.scrollTop + 360
    ) {
      element.scrollTop = rowTop;
      setTop(rowTop);
    }
  }, [selected, columns]);
  const rows = Math.ceil(total / columns);
  const firstRow = Math.min(
    Math.max(0, rows - 1),
    Math.max(0, Math.floor(top / PDF_THUMBNAIL_ROW_HEIGHT) - 1)
  );
  const lastRow = Math.min(rows, firstRow + 5);
  return {
    ref,
    columns,
    start: firstRow * columns + 1,
    end: Math.min(total, lastRow * columns),
    before: firstRow * PDF_THUMBNAIL_ROW_HEIGHT,
    after: (rows - lastRow) * PDF_THUMBNAIL_ROW_HEIGHT,
    onScroll: () => setTop(ref.current?.scrollTop ?? 0),
  };
}
