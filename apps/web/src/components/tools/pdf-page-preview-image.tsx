'use client';

interface PdfPagePreviewImageProps {
  canvas: HTMLCanvasElement;
  alt: string;
  className?: string;
  draggable?: boolean;
}

export function PdfPagePreviewImage({
  canvas,
  alt,
  className,
  draggable,
}: PdfPagePreviewImageProps) {
  return (
    // Canvas previews are already in-memory data URLs, so Next/Image cannot optimize them.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={canvas.toDataURL()}
      alt={alt}
      width={canvas.width}
      height={canvas.height}
      className={className}
      draggable={draggable}
    />
  );
}
