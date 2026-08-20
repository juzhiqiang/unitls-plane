'use client';

import { useTranslations } from 'next-intl';
import type { CompressOptions } from '@/lib/processing/image-client';
import { idPhotoPresetSpecs } from '@utils-plane/validators';
import type { EncodableImageType } from '@/lib/processing/image-encoding-support';

export type CompressFormat = EncodableImageType;

/**
 * 压缩模式。
 * - quality:  只按质量编码,不限制体积(所见即所得)。
 * - targetSize: 迭代降质/缩放直到落在目标体积内,质量滑杆此时不生效。
 */
export type CompressMode = 'quality' | 'targetSize';

export const COMPRESS_MODES: CompressMode[] = ['quality', 'targetSize'];

/** 目标体积可选范围(KB)。下限对齐各类报名系统常见的 20KB 要求。 */
export const MIN_TARGET_SIZE_KB = 10;
export const MAX_TARGET_SIZE_KB = 20 * 1024;

/** 报名/OA 系统最常见的几档体积要求。 */
export const TARGET_SIZE_PRESETS_KB = [20, 50, 100, 200, 500, 1024];

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
  // 证件照尺寸只有一处事实源:此前这里写死 413×579,与 two_inch 的 413×626 对不上。
  id1: {
    width: idPhotoPresetSpecs.one_inch.widthPx,
    height: idPhotoPresetSpecs.one_inch.heightPx,
  },
  id2: {
    width: idPhotoPresetSpecs.two_inch.widthPx,
    height: idPhotoPresetSpecs.two_inch.heightPx,
  },
  custom: {},
};

export interface ImageCompressOptionsState {
  mode: CompressMode;
  quality: number; // 1-100
  targetSizeKB: number;
  sizePreset: SizePreset;
  customWidth: number;
  customHeight: number;
  outputType: CompressFormat;
  /**
   * 保留 EXIF(拍摄参数、镜头、GPS 定位等)。
   *
   * 默认 false:重编码本来就会丢掉元数据,把这件事变成一个明确的、默认保护隐私的
   * 选择,而不是一个用户无从知晓的副作用。
   */
  preserveExif: boolean;
}

export const DEFAULT_IMAGE_COMPRESS_OPTIONS: ImageCompressOptionsState = {
  mode: 'quality',
  quality: 80,
  targetSizeKB: 500,
  sizePreset: 'original',
  customWidth: 1920,
  customHeight: 1080,
  outputType: 'image/jpeg',
  preserveExif: false,
};

/**
 * 本地保留 EXIF 是否会真正生效。
 *
 * browser-image-compression 内部的门槛是「源文件是 JPEG 且输出类型与源一致」,
 * 不满足时它既不报错也不保留 —— 又一个静默失效。UI 必须据此明确提示,不能让用户
 * 以为勾上就有效。服务端走 sharp,没有这个限制。
 */
export function canPreserveExifLocally(
  inputType: string,
  outputType: CompressFormat
): boolean {
  return inputType === 'image/jpeg' && outputType === 'image/jpeg';
}

export function clampTargetSizeKB(value: number): number {
  if (!Number.isFinite(value))
    return DEFAULT_IMAGE_COMPRESS_OPTIONS.targetSizeKB;
  return Math.min(
    MAX_TARGET_SIZE_KB,
    Math.max(MIN_TARGET_SIZE_KB, Math.round(value))
  );
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

/**
 * 目标体积模式下用于起步的编码质量。
 *
 * 不复用用户的 quality:目标体积模式里质量滑杆是隐藏的,而 browser-image-compression
 * 是从 initialQuality 往下搜索,起点太低会让它没有下探空间、直接输出偏小的图。
 */
const TARGET_SIZE_INITIAL_QUALITY = 0.92;

export function toCompressOptions(
  state: ImageCompressOptionsState
): CompressOptions {
  const { width, height } = resolveSize(state);
  const targetSize = state.mode === 'targetSize';

  return {
    quality: targetSize ? TARGET_SIZE_INITIAL_QUALITY : state.quality / 100,
    // 只在目标体积模式下限制体积;质量模式必须不传,否则库会把结果再压一遍。
    ...(targetSize && {
      maxSizeMB: clampTargetSizeKB(state.targetSizeKB) / 1024,
    }),
    ...(width !== undefined && { maxWidth: width }),
    ...(height !== undefined && { maxHeight: height }),
    outputType: state.outputType,
    preserveExif: state.preserveExif,
  };
}

/** 服务端 compress 任务的 inputConfig(与本地模式保持同一套语义)。 */
export function toServerCompressConfig(
  state: ImageCompressOptionsState
): Record<string, unknown> {
  const { width, height } = resolveSize(state);

  return {
    format: SERVER_COMPRESS_FORMATS[state.outputType],
    quality:
      state.mode === 'targetSize'
        ? Math.round(TARGET_SIZE_INITIAL_QUALITY * 100)
        : state.quality,
    ...(state.mode === 'targetSize' && {
      maxSizeKB: clampTargetSizeKB(state.targetSizeKB),
    }),
    ...(width !== undefined && { maxWidth: width }),
    ...(height !== undefined && { maxHeight: height }),
    preserveExif: state.preserveExif,
  };
}

export interface ImageCompressOptionsProps {
  value: ImageCompressOptionsState;
  onChange: (value: ImageCompressOptionsState) => void;
  disabled?: boolean;
  /** 本地可编码的格式;不在其中的会标注为「需服务端」。 */
  locallyEncodable?: Set<string>;
  /** 当前是否处于本地处理模式。 */
  localMode?: boolean;
  /** 本地模式下,当前这批文件保留 EXIF 是否会真正生效(见 canPreserveExifLocally)。 */
  localExifApplies?: boolean;
}

const FORMAT_LABELS: Record<CompressFormat, string> = {
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
  'image/png': 'PNG',
  'image/avif': 'AVIF',
};

export const COMPRESS_FORMATS = Object.keys(FORMAT_LABELS) as CompressFormat[];

export const SERVER_COMPRESS_FORMATS: Record<CompressFormat, string> = {
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
  'image/png': 'png',
  'image/avif': 'avif',
};

/** 压缩输出的扩展名。 */
export const COMPRESS_EXTENSIONS: Record<CompressFormat, string> = {
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/png': 'png',
  'image/avif': 'avif',
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
  locallyEncodable,
  localMode = false,
  localExifApplies = true,
}: ImageCompressOptionsProps) {
  const t = useTranslations('ImageCompress');
  const isCustom = value.sizePreset === 'custom';
  const isOriginal = value.sizePreset === 'original';
  const isTargetSize = value.mode === 'targetSize';
  const formatNeedsServer =
    localMode &&
    locallyEncodable !== undefined &&
    !locallyEncodable.has(value.outputType);
  // 勾了保留但本地这条链路根本不会保留,必须说破,否则用户会以为元数据还在。
  const exifWontApplyLocally =
    value.preserveExif && localMode && !localExifApplies;

  return (
    <div className="space-y-6">
      {/* Compress mode */}
      <div className="space-y-2">
        <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
          {t('mode')}
        </div>
        <div className="inline-flex border border-border rounded-md p-0.5">
          {COMPRESS_MODES.map(mode => (
            <button
              key={mode}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ ...value, mode })}
              className={`px-3 h-8 text-xs font-mono transition-colors rounded-sm ${
                value.mode === mode
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t(`modes.${mode}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Quality (quality mode only) */}
      {!isTargetSize && (
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
            onChange={e =>
              onChange({ ...value, quality: Number(e.target.value) })
            }
            className="w-full accent-accent"
          />
        </div>
      )}

      {/* Target size (target-size mode only) */}
      {isTargetSize && (
        <div className="space-y-2">
          <label
            htmlFor="targetSizeKB"
            className="text-xs font-mono text-muted-foreground uppercase tracking-wider"
          >
            {t('targetSize')}
          </label>
          <div className="flex flex-wrap gap-1.5">
            {TARGET_SIZE_PRESETS_KB.map(kb => (
              <button
                key={kb}
                type="button"
                disabled={disabled}
                onClick={() => onChange({ ...value, targetSizeKB: kb })}
                className={`px-2.5 py-1.5 text-xs font-mono tabular-nums transition-colors rounded-md border ${
                  value.targetSizeKB === kb
                    ? 'bg-foreground text-background border-foreground'
                    : 'text-muted-foreground border-border hover:text-foreground hover:border-foreground/40'
                }`}
              >
                {kb >= 1024 ? `${kb / 1024} MB` : `${kb} KB`}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <input
              id="targetSizeKB"
              type="number"
              min={MIN_TARGET_SIZE_KB}
              max={MAX_TARGET_SIZE_KB}
              value={value.targetSizeKB}
              disabled={disabled}
              onChange={e =>
                onChange({
                  ...value,
                  targetSizeKB: Number(e.target.value) || 0,
                })
              }
              onBlur={e =>
                onChange({
                  ...value,
                  targetSizeKB: clampTargetSizeKB(Number(e.target.value)),
                })
              }
              className="w-32 h-9 px-3 bg-transparent border border-border rounded-md text-sm font-mono tabular-nums focus:outline-none focus:border-accent"
            />
            <span className="text-xs font-mono text-muted-foreground">KB</span>
          </div>
          <p className="text-[10px] font-mono text-muted-foreground">
            {value.outputType === 'image/png'
              ? t('targetSizePngHint')
              : t('targetSizeHint')}
          </p>
        </div>
      )}

      {/* Size preset */}
      <div className="space-y-2">
        <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
          {t('size')}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {PRESET_ORDER.map(preset => {
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
                onChange={e =>
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
                onChange={e =>
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
          {COMPRESS_FORMATS.map(fmt => (
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
        {formatNeedsServer && (
          <p className="text-[10px] font-mono text-muted-foreground pt-1">
            {t('formatNeedsServer', {
              format: FORMAT_LABELS[value.outputType],
            })}
          </p>
        )}
      </div>

      {/* Metadata */}
      <div className="space-y-2">
        <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
          {t('metadata')}
        </div>
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={value.preserveExif}
            disabled={disabled}
            onChange={e =>
              onChange({ ...value, preserveExif: e.target.checked })
            }
            className="mt-0.5 accent-accent"
          />
          <span className="text-xs font-mono">{t('preserveExif')}</span>
        </label>
        <p className="text-[10px] font-mono text-muted-foreground">
          {value.preserveExif ? t('preserveExifOn') : t('preserveExifOff')}
        </p>
        {exifWontApplyLocally && (
          <p className="text-[10px] font-mono text-muted-foreground">
            {t('preserveExifLocalLimit')}
          </p>
        )}
      </div>
    </div>
  );
}
