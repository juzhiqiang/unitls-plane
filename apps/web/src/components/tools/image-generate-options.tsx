'use client';

import { useTranslations } from 'next-intl';
import {
  IMAGE_GENERATE_PROMPT_MAX_LENGTH,
  type ImageGenerateQuality,
  type ImageGenerateSize,
  type ImageGenerateStyle,
} from '@utils-plane/validators';

export interface ImageGenerateDraft {
  prompt: string;
  size: ImageGenerateSize;
  quality: ImageGenerateQuality;
  style?: ImageGenerateStyle;
  count: number;
}

const SIZES: ImageGenerateSize[] = ['1024x1024', '1024x1536', '1536x1024'];
const QUALITIES: ImageGenerateQuality[] = ['standard', 'high'];
const STYLES: ImageGenerateStyle[] = [
  'photographic',
  'illustration',
  'anime',
  'three_d',
  'watercolor',
  'line_art',
];
const COUNTS = [1, 2, 4];

// IMAGE_GENERATE_PROMPT_MAX_LENGTH 由 @utils-plane/validators 导出,这里直接复用,
// 避免跨包重复魔数。

interface ImageGenerateOptionsProps {
  value: ImageGenerateDraft;
  onChange: (next: ImageGenerateDraft) => void;
  disabled?: boolean;
}

interface RadioRowProps<T extends string | number> {
  name: string;
  legend: string;
  options: Array<{ value: T; label: string }>;
  selected: T;
  disabled: boolean;
  onSelect: (value: T) => void;
}

function RadioRow<T extends string | number>({
  name,
  legend,
  options,
  selected,
  disabled,
  onSelect,
}: RadioRowProps<T>) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(option => (
          <label
            key={String(option.value)}
            className="cursor-pointer rounded-md border px-3 py-1.5 text-sm has-[:checked]:border-foreground has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
          >
            <input
              type="radio"
              name={name}
              className="sr-only"
              value={String(option.value)}
              checked={selected === option.value}
              disabled={disabled}
              onChange={() => onSelect(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ImageGenerateOptions({
  value,
  onChange,
  disabled = false,
}: ImageGenerateOptionsProps) {
  const t = useTranslations('ImageGenerate');

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="image-generate-prompt" className="text-sm font-medium">
          {t('promptLabel')}
        </label>
        <textarea
          id="image-generate-prompt"
          className="min-h-28 w-full rounded-md border bg-background p-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          maxLength={IMAGE_GENERATE_PROMPT_MAX_LENGTH}
          placeholder={t('promptPlaceholder')}
          value={value.prompt}
          disabled={disabled}
          onChange={event => onChange({ ...value, prompt: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">{t('promptHint')}</p>
      </div>

      <RadioRow
        name="image-generate-size"
        legend={t('sizeLabel')}
        selected={value.size}
        disabled={disabled}
        options={SIZES.map(size => ({
          value: size,
          label: t(`sizes.${size}`),
        }))}
        onSelect={size => onChange({ ...value, size })}
      />

      <RadioRow
        name="image-generate-quality"
        legend={t('qualityLabel')}
        selected={value.quality}
        disabled={disabled}
        options={QUALITIES.map(quality => ({
          value: quality,
          label: t(`qualities.${quality}`),
        }))}
        onSelect={quality => onChange({ ...value, quality })}
      />

      <RadioRow
        name="image-generate-style"
        legend={t('styleLabel')}
        selected={value.style ?? 'none'}
        disabled={disabled}
        options={[
          { value: 'none' as const, label: t('styles.none') },
          ...STYLES.map(style => ({
            value: style,
            label: t(`styles.${style}`),
          })),
        ]}
        onSelect={style =>
          onChange({
            ...value,
            style: style === 'none' ? undefined : (style as ImageGenerateStyle),
          })
        }
      />

      <RadioRow
        name="image-generate-count"
        legend={t('countLabel')}
        selected={value.count}
        disabled={disabled}
        options={COUNTS.map(count => ({ value: count, label: String(count) }))}
        onSelect={count => onChange({ ...value, count })}
      />
    </div>
  );
}
