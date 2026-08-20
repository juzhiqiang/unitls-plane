'use client';

import { useEffect, useRef, useState } from 'react';
import type { MosaicRegion } from '@/lib/mosaic/geometry';
import { isUsableRegion } from '@/lib/mosaic/geometry';
import { cn } from '@/lib/utils';

const VIEWPORT_MAX = 460;

export interface MosaicRegionFieldProps {
  imageUrl: string;
  natural: { width: number; height: number } | null;
  onNatural: (size: { width: number; height: number }) => void;
  regions: MosaicRegion[];
  onChange: (regions: MosaicRegion[]) => void;
  disabled?: boolean;
  t: (key: string) => string;
}

/**
 * 打码选区:在预览图上拖框,可框多处,点已有框可删除。
 *
 * 选区以归一化坐标存,预览缩放比例与出图无关 —— 组件只把指针坐标换算成 0..1。
 */
export function MosaicRegionField({
  imageUrl,
  natural,
  onNatural,
  regions,
  onChange,
  disabled,
  t,
}: MosaicRegionFieldProps) {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<MosaicRegion | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(
    null
  );

  useEffect(() => {
    if (!natural) return;
    const scale = Math.min(
      1,
      VIEWPORT_MAX / natural.width,
      VIEWPORT_MAX / natural.height
    );
    setViewport({
      width: Math.round(natural.width * scale),
      height: Math.round(natural.height * scale),
    });
  }, [natural]);

  const toNormalized = (event: React.PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return { x: 0, y: 0 };
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !natural) return;
    const point = toNormalized(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, ...point };
    setDraft({ x: point.x, y: point.y, width: 0, height: 0 });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = toNormalized(event);
    setDraft({
      x: Math.min(drag.x, point.x),
      y: Math.min(drag.y, point.y),
      width: Math.abs(point.x - drag.x),
      height: Math.abs(point.y - drag.y),
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;

    if (
      draft &&
      natural &&
      isUsableRegion(draft, natural.width, natural.height)
    ) {
      onChange([...regions, draft]);
    }
    setDraft(null);
  };

  const toStyle = (region: MosaicRegion) => ({
    left: `${region.x * 100}%`,
    top: `${region.y * 100}%`,
    width: `${region.width * 100}%`,
    height: `${region.height * 100}%`,
  });

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="relative mx-auto select-none touch-none overflow-hidden rounded-md border border-border bg-muted"
        style={
          viewport.width
            ? { width: viewport.width, height: viewport.height }
            : undefined
        }
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={t('regionPreviewAlt')}
          draggable={false}
          onLoad={event =>
            onNatural({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
          className="block h-full w-full object-contain"
        />

        {regions.map((region, index) => (
          <button
            key={`${region.x}-${region.y}-${index}`}
            type="button"
            disabled={disabled}
            aria-label={t('removeRegion')}
            title={t('removeRegion')}
            onPointerDown={event => event.stopPropagation()}
            onClick={() => onChange(regions.filter((_, i) => i !== index))}
            className="absolute border-2 border-accent bg-accent/25 transition-colors hover:bg-accent/40"
            style={toStyle(region)}
          />
        ))}

        {draft && (
          <div
            className="pointer-events-none absolute border-2 border-dashed border-accent bg-accent/20"
            style={toStyle(draft)}
          />
        )}
      </div>

      <p
        className={cn(
          'text-center text-[10px] font-mono',
          regions.length === 0 ? 'text-muted-foreground' : 'text-foreground'
        )}
      >
        {regions.length === 0
          ? t('regionHint')
          : t('regionCount').replace('{count}', String(regions.length))}
      </p>
    </div>
  );
}
