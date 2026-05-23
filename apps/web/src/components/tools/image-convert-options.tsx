'use client';

import { useTranslations } from 'next-intl';
import type { ImageOutputType } from '@/lib/processing/image-convert-client';

export interface ImageConvertOptionsState {
  toFormat: ImageOutputType;
  quality: number; // 1-100
}

export interface ImageConvertOptionsProps {
  value: ImageConvertOptionsState;
  onChange: (value: ImageConvertOptionsState) => void;
  disabled?: boolean;
}

const FORMAT_LABELS: Record<ImageOutputType, string> = {
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
  'image/png': 'PNG',
};

export function ImageConvertOptions({
  value,
  onChange,
  disabled,
}: ImageConvertOptionsProps) {
  const t = useTranslations('ImageConvert');
  const supportsQuality =
    value.toFormat === 'image/jpeg' || value.toFormat === 'image/webp';

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
          {t('targetFormat')}
        </div>
        <div className="inline-flex border border-border rounded-md p-0.5">
          {(Object.keys(FORMAT_LABELS) as ImageOutputType[]).map((fmt) => (
            <button
              key={fmt}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ ...value, toFormat: fmt })}
              className={`px-3 h-8 text-xs font-mono transition-colors rounded-sm ${
                value.toFormat === fmt
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {FORMAT_LABELS[fmt]}
            </button>
          ))}
        </div>
      </div>

      {supportsQuality && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label
              htmlFor="conv-quality"
              className="text-xs font-mono text-muted-foreground uppercase tracking-wider"
            >
              {t('quality')}
            </label>
            <span className="text-xs font-mono tabular-nums">
              {value.quality}%
            </span>
          </div>
          <input
            id="conv-quality"
            type="range"
            min={1}
            max={100}
            value={value.quality}
            disabled={disabled}
            onChange={(e) =>
              onChange({ ...value, quality: Number(e.target.value) })
            }
            className="w-full accent-accent"
          />
        </div>
      )}
    </div>
  );
}
