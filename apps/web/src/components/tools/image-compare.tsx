'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState, type CSSProperties } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatBytes } from '@/lib/format';

const IMAGE_COMPARE_MAX_HEIGHT = 480;

export function getImageCompareFrameStyle(aspectRatio: number): CSSProperties {
  const safeAspectRatio =
    Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;

  return {
    aspectRatio: safeAspectRatio,
    width: '100%',
    maxWidth: `${Math.round(IMAGE_COMPARE_MAX_HEIGHT * safeAspectRatio)}px`,
  };
}

const ImageCompareSlider = dynamic(
  () =>
    import('./image-compare-slider.client').then(mod => mod.ImageCompareSlider),
  {
    ssr: false,
    loading: () => <div aria-hidden className="h-full w-full bg-muted/20" />,
  }
);

export interface ImageCompareProps {
  original: File;
  result: File;
}

export function ImageCompare({ original, result }: ImageCompareProps) {
  const t = useTranslations('ToolsShared');
  const tUnits = useTranslations('Common.units');
  const locale = useLocale();
  const [originalUrl, setOriginalUrl] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);

  useEffect(() => {
    const oUrl = URL.createObjectURL(original);
    const rUrl = URL.createObjectURL(result);
    const image = new Image();

    setAspectRatio(null);
    setOriginalUrl(oUrl);
    setResultUrl(rUrl);

    image.onload = () => {
      const nextAspectRatio = image.naturalWidth / image.naturalHeight;
      setAspectRatio(
        Number.isFinite(nextAspectRatio) && nextAspectRatio > 0
          ? nextAspectRatio
          : 1
      );
    };
    image.onerror = () => setAspectRatio(1);
    image.src = oUrl;

    return () => {
      image.onload = null;
      image.onerror = null;
      URL.revokeObjectURL(oUrl);
      URL.revokeObjectURL(rUrl);
    };
  }, [original, result]);

  const ratio = ((1 - result.size / original.size) * 100).toFixed(1);

  if (!originalUrl || !resultUrl || aspectRatio === null) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-6 text-xs font-mono">
        <div className="space-y-1">
          <span className="text-muted-foreground uppercase tracking-wider">
            {t('compare.original')}
          </span>
          <div className="text-foreground tabular-nums">
            {formatBytes(original.size, tUnits, locale)}
          </div>
        </div>
        <div className="space-y-1">
          <span className="text-muted-foreground uppercase tracking-wider">
            {t('compare.result')}
          </span>
          <div className="text-foreground tabular-nums">
            {formatBytes(result.size, tUnits, locale)}
          </div>
        </div>
        <div className="space-y-1">
          <span className="text-muted-foreground uppercase tracking-wider">
            {t('compare.ratio')}
          </span>
          <div className="text-foreground tabular-nums">{ratio}%</div>
        </div>
      </div>

      <div
        className="mx-auto overflow-hidden rounded-md border border-border bg-muted/20"
        style={getImageCompareFrameStyle(aspectRatio)}
      >
        <ImageCompareSlider originalUrl={originalUrl} resultUrl={resultUrl} />
      </div>

      <div className="flex justify-between text-[10px] font-mono text-muted-foreground uppercase tracking-wider px-1">
        <span>{t('compare.beforeLabel')}</span>
        <span>{t('compare.afterLabel')}</span>
      </div>
    </div>
  );
}
