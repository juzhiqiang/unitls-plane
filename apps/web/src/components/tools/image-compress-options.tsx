'use client';

import { useTranslations } from 'next-intl';
import type { CompressOptions } from '@/lib/processing/image-client';

export type CompressFormat = 'image/jpeg' | 'image/webp' | 'image/png';

export type SizePreset =
  | 'original'
  | 'desktop'
  | 'mobile'
  | 'id1'
  | 'id2'
  | 'custom';

interface PresetMeta {
  width?: number;
  height?: number;
}

export const SIZE_PRESETS: Record<SizePreset, PresetMeta> = {
  original: {},
  desktop: { width: 1920, height: 1080 },
  mobile: { width: 750, height: 480 },
  id1: { width: 295, height: 413 },
  id2: { width: 413, height: 579 },
  custom: {},
};

export interface ImageCompressOptionsState {
  quality: number; // 1-100
  sizePreset: SizePreset;
  customWidth: number;
  customHeight: number;
  outputType: CompressFormat;
}

export function resolveSize(state: ImageCompressOptionsState): {
  width?: number;
  height?: number;
} {
  if (state.sizePreset === 'original') return {};
  if (state.sizePreset === 'custom') {
    return { width: state.customWidth, height: state.customHeight };
  }
  const preset = SIZE_PRESETS[state.sizePreset];
  return { width: preset.width, height: preset.height };
}

export function toCompressOptions(
  state: ImageCompressOptionsState,
): CompressOptions {
  const { width, height } = resolveSize(state);
  return {
    quality: state.quality / 100,
    ...(width !== undefined && { maxWidth: width }),
    ...(height !== undefined && { maxHeight: height }),
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

const PRESET_ORDER: SizePreset[] = [
  'original',
  'desktop',
  'mobile',
  'id1',
  'id2',
  'custom',
];

function presetSubLabel(preset: SizePreset): string | null {
  const meta = SIZE_PRESETS[preset];
  if (meta.width && meta.height) return `${meta.width}×${meta.height}`;
  return null;
}

export function ImageCompressOptions({
  value,
  onChange,
  disabled,
}: ImageCompressOptionsProps) {
  const t = useTranslations('ImageCompress');
  const isCustom = value.sizePreset === 'custom';
  const isOriginal = value.sizePreset === 'original';

  return (
    <div className="space-y-6">
      {/* Quality */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label
            htmlFor="quality"
            className="text-xs font-mono text-muted-foreground uppercase tracking-wider"
          >
            {t('quality')}
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

      {/* Size preset */}
      <div className="space-y-2">
        <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
          {t('size')}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {PRESET_ORDER.map((preset) => {
            const sub = presetSubLabel(preset);
            const active = value.sizePreset === preset;
            return (
              <button
                key={preset}
                type="button"
                disabled={disabled}
                onClick={() => onChange({ ...value, sizePreset: preset })}
                className={`px-2 py-1.5 text-xs font-mono transition-colors rounded-md border ${
                  active
                    ? 'bg-foreground text-background border-foreground'
                    : 'text-muted-foreground border-border hover:text-foreground hover:border-foreground/40'
                }`}
              >
                <div>{t(`presets.${preset}`)}</div>
                {sub && (
                  <div className="text-[10px] opacity-70 tabular-nums mt-0.5">
                    {sub}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Custom width / height inputs */}
        {isCustom && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div className="space-y-1">
              <label
                htmlFor="customWidth"
                className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider"
              >
                {t('widthPx')}
              </label>
              <input
                id="customWidth"
                type="number"
                min={1}
                max={8192}
                value={value.customWidth}
                disabled={disabled}
                onChange={(e) =>
                  onChange({
                    ...value,
                    customWidth: Number(e.target.value) || 0,
                  })
                }
                className="w-full h-9 px-3 bg-transparent border border-border rounded-md text-sm font-mono focus:outline-none focus:border-accent"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="customHeight"
                className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider"
              >
                {t('heightPx')}
              </label>
              <input
                id="customHeight"
                type="number"
                min={1}
                max={8192}
                value={value.customHeight}
                disabled={disabled}
                onChange={(e) =>
                  onChange({
                    ...value,
                    customHeight: Number(e.target.value) || 0,
                  })
                }
                className="w-full h-9 px-3 bg-transparent border border-border rounded-md text-sm font-mono focus:outline-none focus:border-accent"
              />
            </div>
          </div>
        )}

        {isOriginal && (
          <p className="text-[10px] font-mono text-muted-foreground pt-1">
            {t('originalHint')}
          </p>
        )}
      </div>

      {/* Output format */}
      <div className="space-y-2">
        <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
          {t('outputFormat')}
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
