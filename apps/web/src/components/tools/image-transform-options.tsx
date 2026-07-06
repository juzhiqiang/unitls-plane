'use client';

import {
  FlipHorizontal2,
  FlipVertical2,
  RotateCcw,
  RotateCw,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import {
  rotateClockwise,
  rotateCounterClockwise,
  type NormalizedImageTransform,
} from '@/lib/processing/image-transform-client';

export interface ImageTransformOptionsProps {
  value: NormalizedImageTransform;
  onChange: (value: NormalizedImageTransform) => void;
  disabled?: boolean;
}

export const DEFAULT_IMAGE_TRANSFORM: NormalizedImageTransform = {
  autoOrient: true,
  rotate: 0,
  flipHorizontal: false,
  flipVertical: false,
};

export function ImageTransformOptions({
  value,
  onChange,
  disabled,
}: ImageTransformOptionsProps) {
  const t = useTranslations('ImageTransform');

  const iconButtonClass =
    'flex h-9 w-9 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50';
  const toggleButtonClass =
    'flex h-9 items-center gap-2 rounded-sm px-3 text-xs font-mono transition-colors disabled:opacity-50';

  return (
    <div className="space-y-4 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
          {t('title')}
        </div>
        <label className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
          <input
            type="checkbox"
            checked={value.autoOrient}
            disabled={disabled}
            onChange={e => onChange({ ...value, autoOrient: e.target.checked })}
            className="h-4 w-4 accent-accent"
          />
          {t('autoOrient')}
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-center">
        <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
          {t('rotate')}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-border p-0.5">
            <button
              type="button"
              disabled={disabled}
              aria-label={t('rotateLeft')}
              title={t('rotateLeft')}
              onClick={() =>
                onChange({
                  ...value,
                  rotate: rotateCounterClockwise(value.rotate),
                })
              }
              className={iconButtonClass}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              disabled={disabled}
              aria-label={t('rotateRight')}
              title={t('rotateRight')}
              onClick={() =>
                onChange({
                  ...value,
                  rotate: rotateClockwise(value.rotate),
                })
              }
              className={iconButtonClass}
            >
              <RotateCw className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              disabled={disabled || value.rotate === 0}
              onClick={() => onChange({ ...value, rotate: 0 })}
              className="h-9 rounded-sm px-3 text-xs font-mono text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              {t('resetRotation')}
            </button>
          </div>
          <span className="text-xs font-mono tabular-nums text-muted-foreground">
            {t('currentRotation', { degrees: value.rotate })}
          </span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-center">
        <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
          {t('flip')}
        </div>
        <div className="inline-flex w-fit rounded-md border border-border p-0.5">
          <button
            type="button"
            disabled={disabled}
            aria-pressed={value.flipHorizontal}
            onClick={() =>
              onChange({
                ...value,
                flipHorizontal: !value.flipHorizontal,
              })
            }
            className={cn(
              toggleButtonClass,
              value.flipHorizontal
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <FlipHorizontal2 className="h-4 w-4" aria-hidden="true" />
            {t('flipHorizontal')}
          </button>
          <button
            type="button"
            disabled={disabled}
            aria-pressed={value.flipVertical}
            onClick={() =>
              onChange({
                ...value,
                flipVertical: !value.flipVertical,
              })
            }
            className={cn(
              toggleButtonClass,
              value.flipVertical
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <FlipVertical2 className="h-4 w-4" aria-hidden="true" />
            {t('flipVertical')}
          </button>
        </div>
      </div>
    </div>
  );
}
