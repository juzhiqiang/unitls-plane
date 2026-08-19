'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clampIdPhotoCrop,
  DEFAULT_ID_PHOTO_CROP,
  type IdPhotoCrop,
} from '@utils-plane/validators';

/** 预览框高度(px)。宽度由证件照比例推出,保证所见即所得。 */
const VIEWPORT_HEIGHT = 320;

const MIN_SCALE = 1;
const MAX_SCALE = 3;

export interface IdPhotoCropProps {
  /** 源图 object URL。 */
  imageUrl: string;
  presetWidth: number;
  presetHeight: number;
  value: IdPhotoCrop;
  onChange: (crop: IdPhotoCrop) => void;
  disabled?: boolean;
  t: (key: string) => string;
}

/**
 * 证件照裁剪框。
 *
 * 预览框固定为目标证件照的宽高比,图片在框内平移/缩放,框中看到的就是最终构图。
 * 归一化参数(x/y 为裁剪中心、scale 为相对基准框的放大倍数)与
 * validators.resolveIdPhotoCropBox 完全对应 —— 边界夹取也复用 clampIdPhotoCrop,
 * 所以「能拖到的位置」和「实际出图范围」不会有偏差。
 */
export function IdPhotoCropField({
  imageUrl,
  presetWidth,
  presetHeight,
  value,
  onChange,
  disabled,
  t,
}: IdPhotoCropProps) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startCrop: IdPhotoCrop;
  } | null>(null);

  useEffect(() => {
    // 换图后必须清掉旧尺寸,否则新图会短暂按上一张的宽高定位。
    setNatural(null);
  }, [imageUrl]);

  const viewportWidth = VIEWPORT_HEIGHT * (presetWidth / presetHeight);

  const commit = useCallback(
    (next: IdPhotoCrop) => {
      if (!natural) return;
      onChange(
        clampIdPhotoCrop(natural.w, natural.h, presetWidth, presetHeight, next)
      );
    },
    [natural, onChange, presetWidth, presetHeight]
  );

  // 切换预设会改变宽高比,原本合法的 crop 可能越界。渲染前统一夹一次,
  // 预览框就不会出现露底的缝隙,也与出图范围保持一致。
  const display = natural
    ? clampIdPhotoCrop(natural.w, natural.h, presetWidth, presetHeight, value)
    : value;

  // 图片铺满预览框所需的缩放:与基准框到预览框的换算是同一个系数。
  const coverScale = natural
    ? Math.max(viewportWidth / natural.w, VIEWPORT_HEIGHT / natural.h)
    : 1;
  const renderScale = coverScale * display.scale;
  const renderedWidth = natural ? natural.w * renderScale : 0;
  const renderedHeight = natural ? natural.h * renderScale : 0;
  const offsetX = viewportWidth / 2 - display.x * renderedWidth;
  const offsetY = VIEWPORT_HEIGHT / 2 - display.y * renderedHeight;

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !natural) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startCrop: display,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !natural) return;
    // 图片右移 dx px,裁剪窗口在源图坐标里左移同样的距离。
    const dx = (event.clientX - drag.startX) / renderScale / natural.w;
    const dy = (event.clientY - drag.startY) / renderScale / natural.h;
    commit({
      x: drag.startCrop.x - dx,
      y: drag.startCrop.y - dy,
      scale: drag.startCrop.scale,
    });
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-mono text-muted-foreground">
          {t('crop')}
        </label>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(DEFAULT_ID_PHOTO_CROP)}
          className="text-xs font-mono text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {t('cropReset')}
        </button>
      </div>

      <div
        className="relative mx-auto overflow-hidden rounded-md border border-border bg-muted touch-none"
        style={{ width: viewportWidth, height: VIEWPORT_HEIGHT }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* 始终渲染 img:尺寸由它自己的 onLoad 提供。尺寸未知时先用 object-fit
            铺满预览框,避免出现空盒子。 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={t('cropPreviewAlt')}
          draggable={false}
          onLoad={event =>
            setNatural({
              w: event.currentTarget.naturalWidth,
              h: event.currentTarget.naturalHeight,
            })
          }
          className="absolute max-w-none select-none"
          style={
            natural
              ? {
                  width: renderedWidth,
                  height: renderedHeight,
                  left: offsetX,
                  top: offsetY,
                  cursor: disabled ? 'default' : 'grab',
                }
              : {
                  width: '100%',
                  height: '100%',
                  left: 0,
                  top: 0,
                  objectFit: 'cover',
                }
          }
        />

        {/* 证件照参考线:头顶留白与视线高度是最常见的返工原因 */}
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute inset-x-0 border-t border-dashed border-white/60"
            style={{ top: '10%' }}
          />
          <div
            className="absolute inset-x-0 border-t border-dashed border-white/60"
            style={{ top: '52%' }}
          />
          <div className="absolute inset-y-0 left-1/2 border-l border-dashed border-white/30" />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
          {t('cropZoom')}
        </span>
        <input
          type="range"
          min={MIN_SCALE}
          max={MAX_SCALE}
          step={0.02}
          value={display.scale}
          disabled={disabled || !natural}
          onChange={event =>
            commit({ ...display, scale: Number(event.target.value) })
          }
          className="w-full accent-accent"
        />
        <span className="w-12 text-right text-xs font-mono tabular-nums">
          {display.scale.toFixed(2)}×
        </span>
      </div>

      <p className="text-[10px] font-mono text-muted-foreground">
        {t('cropHint')}
      </p>
    </div>
  );
}
