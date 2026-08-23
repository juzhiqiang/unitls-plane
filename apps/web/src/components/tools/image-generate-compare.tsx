'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getImageCompareFrameStyle } from './image-compare';

const ImageCompareSlider = dynamic(
  () =>
    import('./image-compare-slider.client').then(mod => mod.ImageCompareSlider),
  {
    ssr: false,
    loading: () => <div aria-hidden className="h-full w-full bg-muted/20" />,
  }
);

interface ImageGenerateCompareProps {
  beforeUrl: string;
  afterUrl: string;
  title: string;
}

/**
 * 图生图的前后对比。
 *
 * 不复用 ImageCompare:那个组件的头部是压缩专用的(原始体积/结果体积/压缩率),
 * 对图生图没有意义。这里只借用它的画框尺寸算法与滑块本体。
 *
 * aspectRatio 初值给 1 而不是 null:结果图的真实比例要等 onload 才知道,
 * 若初值为空就得先渲染空白再跳一次,对比区会闪。
 */
export function ImageGenerateCompare({
  beforeUrl,
  afterUrl,
  title,
}: ImageGenerateCompareProps) {
  const t = useTranslations('ToolsShared');
  const [aspectRatio, setAspectRatio] = useState(1);

  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      const next = image.naturalWidth / image.naturalHeight;
      setAspectRatio(Number.isFinite(next) && next > 0 ? next : 1);
    };
    image.src = afterUrl;
    return () => {
      image.onload = null;
    };
  }, [afterUrl]);

  return (
    <div className="space-y-2">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <div
        className="mx-auto overflow-hidden rounded-md border border-border bg-muted/20"
        style={getImageCompareFrameStyle(aspectRatio)}
      >
        <ImageCompareSlider originalUrl={beforeUrl} resultUrl={afterUrl} />
      </div>
      <div className="flex justify-between px-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>{t('compare.beforeLabel')}</span>
        <span>{t('compare.afterLabel')}</span>
      </div>
    </div>
  );
}
