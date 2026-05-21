'use client';

import type { CompressOptions } from '@/lib/processing/image-client';

export type CompressFormat = 'image/jpeg' | 'image/webp' | 'image/png';

export interface ImageCompressOptionsState {
  quality: number; // 1-100
  maxWidthOrHeight: number;
  outputType: CompressFormat;
}

export function toCompressOptions(
  state: ImageCompressOptionsState,
): CompressOptions {
  return {
    quality: state.quality / 100,
    maxWidthOrHeight: state.maxWidthOrHeight,
    outputType: state.outputType,
  };
}

export interface ImageCompressOptionsProps {
  value: ImageCompressOptionsState;
  onChange: (value: ImageCompressOptionsState) => void;
  disabled?: boolean;
}

const FORMAT_LABELS: Record<CompressFormat, string> = {
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
  'image/png': 'PNG',
};

export function ImageCompressOptions({
  value,
  onChange,
  disabled,
}: ImageCompressOptionsProps) {
  return (
    <div className="space-y-6">
      {/* Quality */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label
            htmlFor="quality"
            className="text-xs font-mono text-muted-foreground uppercase tracking-wider"
          >
            质量
          </label>
          <span className="text-xs font-mono tabular-nums">
            {value.quality}%
          </span>
        </div>
        <input
          id="quality"
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

      {/* Max dimension */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label
            htmlFor="maxDim"
            className="text-xs font-mono text-muted-foreground uppercase tracking-wider"
          >
            最大边长
          </label>
          <span className="text-xs font-mono tabular-nums">
            {value.maxWidthOrHeight}px
          </span>
        </div>
        <input
          id="maxDim"
          type="number"
          min={64}
          max={8192}
          step={64}
          value={value.maxWidthOrHeight}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              ...value,
              maxWidthOrHeight: Number(e.target.value) || 1920,
            })
          }
          className="w-full h-9 px-3 bg-transparent border border-border rounded-md text-sm font-mono focus:outline-none focus:border-accent"
        />
      </div>

      {/* Output format */}
      <div className="space-y-2">
        <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
          输出格式
        </div>
        <div className="inline-flex border border-border rounded-md p-0.5">
          {(Object.keys(FORMAT_LABELS) as CompressFormat[]).map((fmt) => (
            <button
              key={fmt}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ ...value, outputType: fmt })}
              className={`px-3 h-8 text-xs font-mono transition-colors rounded-sm ${
                value.outputType === fmt
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {FORMAT_LABELS[fmt]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
