'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatBytes } from '@/lib/format';

const ImageCompareSlider = dynamic(
  () =>
    import('./image-compare-slider.client').then(
      mod => mod.ImageCompareSlider
    ),
  {
    ssr: false,
    loading: () => (
      <div
        aria-hidden
        className="aspect-video max-h-[480px] bg-muted/20"
      />
    ),
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

  useEffect(() => {
    const oUrl = URL.createObjectURL(original);
    const rUrl = URL.createObjectURL(result);
    setOriginalUrl(oUrl);
    setResultUrl(rUrl);
    return () => {
      URL.revokeObjectURL(oUrl);
      URL.revokeObjectURL(rUrl);
    };
  }, [original, result]);

  const ratio = ((1 - result.size / original.size) * 100).toFixed(1);

  if (!originalUrl || !resultUrl) return null;

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

      <div className="rounded-md border border-border overflow-hidden">
        <ImageCompareSlider originalUrl={originalUrl} resultUrl={resultUrl} />
      </div>

      <div className="flex justify-between text-[10px] font-mono text-muted-foreground uppercase tracking-wider px-1">
        <span>{t('compare.beforeLabel')}</span>
        <span>{t('compare.afterLabel')}</span>
      </div>
    </div>
  );
}
