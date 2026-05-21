'use client';

import {
  ReactCompareSlider,
  ReactCompareSliderImage,
} from 'react-compare-slider';
import { useEffect, useState } from 'react';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export interface ImageCompareProps {
  original: File;
  result: File;
}

export function ImageCompare({ original, result }: ImageCompareProps) {
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
            原始
          </span>
          <div className="text-foreground tabular-nums">
            {formatSize(original.size)}
          </div>
        </div>
        <div className="space-y-1">
          <span className="text-muted-foreground uppercase tracking-wider">
            结果
          </span>
          <div className="text-foreground tabular-nums">
            {formatSize(result.size)}
          </div>
        </div>
        <div className="space-y-1">
          <span className="text-muted-foreground uppercase tracking-wider">
            压缩比
          </span>
          <div className="text-foreground tabular-nums">{ratio}%</div>
        </div>
      </div>

      <div className="rounded-md border border-border overflow-hidden">
        <ReactCompareSlider
          itemOne={
            <ReactCompareSliderImage src={originalUrl} alt="Original" />
          }
          itemTwo={<ReactCompareSliderImage src={resultUrl} alt="Result" />}
          className="aspect-video max-h-[480px]"
        />
      </div>

      <div className="flex justify-between text-[10px] font-mono text-muted-foreground uppercase tracking-wider px-1">
        <span>原图</span>
        <span>处理后</span>
      </div>
    </div>
  );
}
