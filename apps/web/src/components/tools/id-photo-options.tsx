'use client';

import {
  idPhotoBackgroundOptions,
  idPhotoPresetOptions,
} from '@/lib/id-photo/presets';

export type IdPhotoOptionsState = {
  preset: 'one_inch' | 'two_inch' | 'small_one_inch' | 'passport';
  backgroundColor: string;
  outputType: 'image/jpeg' | 'image/png';
  segmentationMode: 'local' | 'ai';
  crop: { x: number; y: number; scale: number };
};

type Props = {
  value: IdPhotoOptionsState;
  onChange: (value: IdPhotoOptionsState) => void;
  t: (key: string) => string;
  disabled?: boolean;
};

export function IdPhotoOptions({ value, onChange, t, disabled }: Props) {
  return (
    <div className="space-y-5 rounded-md border border-border p-4">
      <div className="space-y-2">
        <label className="text-xs font-mono text-muted-foreground">
          {t('preset')}
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          {idPhotoPresetOptions.map(option => (
            <button
              key={option.key}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ ...value, preset: option.key })}
              className={`rounded-md border px-3 py-2 text-left text-sm ${
                value.preset === option.key
                  ? 'border-foreground bg-muted'
                  : 'border-border'
              }`}
            >
              <span className="block font-medium">{t(option.labelKey)}</span>
              <span className="text-xs text-muted-foreground">
                {option.size}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-mono text-muted-foreground">
          {t('background')}
        </label>
        <div className="flex flex-wrap gap-2">
          {idPhotoBackgroundOptions.map(option => (
            <button
              key={option.key}
              type="button"
              disabled={disabled}
              onClick={() =>
                onChange({ ...value, backgroundColor: option.color })
              }
              className={`flex h-9 items-center gap-2 rounded-md border px-3 text-sm ${
                value.backgroundColor === option.color
                  ? 'border-foreground bg-muted'
                  : 'border-border'
              }`}
            >
              <span
                className="h-4 w-4 rounded-full border border-border"
                style={{ backgroundColor: option.color }}
              />
              {t(option.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-mono text-muted-foreground">
          {t('segmentationMode')}
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          {(['local', 'ai'] as const).map(mode => (
            <button
              key={mode}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ ...value, segmentationMode: mode })}
              className={`rounded-md border px-3 py-2 text-left text-sm ${
                value.segmentationMode === mode
                  ? 'border-foreground bg-muted'
                  : 'border-border'
              }`}
            >
              <span className="block font-medium">
                {t(`segmentationModes.${mode}.label`)}
              </span>
              <span className="text-xs text-muted-foreground">
                {t(`segmentationModes.${mode}.description`)}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-mono text-muted-foreground">
          {t('outputType')}
        </label>
        <select
          value={value.outputType}
          disabled={disabled}
          onChange={event =>
            onChange({
              ...value,
              outputType: event.target
                .value as IdPhotoOptionsState['outputType'],
            })
          }
          className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
        >
          <option value="image/jpeg">JPEG</option>
          <option value="image/png">PNG</option>
        </select>
      </div>
    </div>
  );
}
