'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  resizeCropRect,
  type CropHandle,
  type CropRect,
} from '@/lib/crop/geometry';
import { cn } from '@/lib/utils';

const VIEWPORT_MAX = 420;

/** 八个缩放手柄的位置(相对裁剪框的百分比)与光标。 */
const HANDLES: { key: CropHandle; style: string; cursor: string }[] = [
  {
    key: 'nw',
    style: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2',
    cursor: 'nwse-resize',
  },
  {
    key: 'n',
    style: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2',
    cursor: 'ns-resize',
  },
  {
    key: 'ne',
    style: 'left-full top-0 -translate-x-1/2 -translate-y-1/2',
    cursor: 'nesw-resize',
  },
  {
    key: 'e',
    style: 'left-full top-1/2 -translate-x-1/2 -translate-y-1/2',
    cursor: 'ew-resize',
  },
  {
    key: 'se',
    style: 'left-full top-full -translate-x-1/2 -translate-y-1/2',
    cursor: 'nwse-resize',
  },
  {
    key: 's',
    style: 'left-1/2 top-full -translate-x-1/2 -translate-y-1/2',
    cursor: 'ns-resize',
  },
  {
    key: 'sw',
    style: 'left-0 top-full -translate-x-1/2 -translate-y-1/2',
    cursor: 'nesw-resize',
  },
  {
    key: 'w',
    style: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2',
    cursor: 'ew-resize',
  },
];

export interface ImageCropFieldProps {
  imageUrl: string;
  /** 源图像素尺寸;未知时组件在图片 onLoad 后经 onNatural 回填。 */
  natural: { width: number; height: number } | null;
  /**
   * 拿到源图尺寸时回调。
   *
   * 初始裁剪框由父组件决定并通过 value 传入 —— 通用裁剪要「整图/居中定比例」,
   * 证件照要「由已存的 crop 参数还原」,组件自己猜只会两边都不对。
   */
  onNatural: (size: { width: number; height: number }) => void;
  value: CropRect | null;
  onChange: (rect: CropRect) => void;
  aspect: number | null;
  disabled?: boolean;
  t: (key: string) => string;
}

/**
 * 裁剪框交互。
 *
 * 组件只做两件事:把预览尺寸下的指针位移换算成源图像素增量,以及渲染遮罩与手柄。
 * 所有边界、比例、防翻转的判断都在 lib/crop/geometry 里,那部分不依赖 DOM,可以
 * 完整测试 —— 这类交互的 bug 几乎全在几何上,而不在 JSX 上。
 */
export function ImageCropField({
  imageUrl,
  natural,
  onNatural,
  value,
  onChange,
  aspect,
  disabled,
  t,
}: ImageCropFieldProps) {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const dragRef = useRef<{
    pointerId: number;
    handle: CropHandle;
    startX: number;
    startY: number;
    startRect: CropRect;
  } | null>(null);

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

  // 预览像素 → 源图像素
  const toSource = useCallback(
    (px: number, axis: 'x' | 'y') => {
      if (!natural || !viewport.width || !viewport.height) return px;
      return axis === 'x'
        ? (px / viewport.width) * natural.width
        : (px / viewport.height) * natural.height;
    },
    [natural, viewport]
  );

  const beginDrag = (handle: CropHandle) => (event: React.PointerEvent) => {
    if (disabled || !value) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startRect: value,
    };
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !natural) return;
    onChange(
      resizeCropRect(
        drag.startRect,
        drag.handle,
        toSource(event.clientX - drag.startX, 'x'),
        toSource(event.clientY - drag.startY, 'y'),
        natural,
        aspect
      )
    );
  };

  const endDrag = (event: React.PointerEvent) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const box =
    natural && value && viewport.width
      ? {
          left: (value.x / natural.width) * viewport.width,
          top: (value.y / natural.height) * viewport.height,
          width: (value.width / natural.width) * viewport.width,
          height: (value.height / natural.height) * viewport.height,
        }
      : null;

  return (
    <div className="space-y-2">
      <div
        className="relative mx-auto select-none touch-none overflow-hidden rounded-md border border-border bg-muted"
        style={
          viewport.width
            ? { width: viewport.width, height: viewport.height }
            : undefined
        }
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={t('cropPreviewAlt')}
          draggable={false}
          onLoad={event =>
            onNatural({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
          className="block h-full w-full object-contain"
        />

        {box && (
          <>
            {/* 框外压暗,让裁剪范围一眼可辨 */}
            <div
              className="pointer-events-none absolute inset-0 bg-black/50"
              style={{
                clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${box.left}px ${box.top}px, ${box.left}px ${box.top + box.height}px, ${box.left + box.width}px ${box.top + box.height}px, ${box.left + box.width}px ${box.top}px, ${box.left}px ${box.top}px)`,
              }}
            />
            <div
              className={cn(
                'absolute border border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]',
                disabled ? 'cursor-default' : 'cursor-move'
              )}
              style={{
                left: box.left,
                top: box.top,
                width: box.width,
                height: box.height,
              }}
              onPointerDown={beginDrag('move')}
            >
              {/* 三分线 */}
              <div className="pointer-events-none absolute inset-0 opacity-60">
                <div className="absolute inset-y-0 left-1/3 border-l border-white/40" />
                <div className="absolute inset-y-0 left-2/3 border-l border-white/40" />
                <div className="absolute inset-x-0 top-1/3 border-t border-white/40" />
                <div className="absolute inset-x-0 top-2/3 border-t border-white/40" />
              </div>

              {HANDLES.map(handle => (
                <span
                  key={handle.key}
                  role="slider"
                  tabIndex={-1}
                  aria-label={t(`handles.${handle.key}`)}
                  aria-valuenow={0}
                  onPointerDown={beginDrag(handle.key)}
                  style={{ cursor: disabled ? 'default' : handle.cursor }}
                  className={cn(
                    'absolute h-2.5 w-2.5 rounded-sm border border-black/40 bg-white',
                    handle.style
                  )}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {value && (
        <p className="text-center text-[10px] font-mono tabular-nums text-muted-foreground">
          {value.width} × {value.height}
        </p>
      )}
    </div>
  );
}
