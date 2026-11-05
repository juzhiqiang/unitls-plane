'use client';

import { useTranslations } from 'next-intl';
import { MAX_TRY_ON_REFERENCES } from './types';
import { TryOnPresetsBar } from './TryOnPresetsBar';
import type { TryOnWorkbench } from './useTryOnWorkbench';

type TryOnModePanelProps = Pick<
  TryOnWorkbench,
  | 'form'
  | 'task'
  | 'quotaQuery'
  | 'libraries'
  | 'activeReferenceCount'
  | 'quotaExhausted'
  | 'quotaLoadFailed'
>;

export function TryOnModePanel({
  form,
  task,
  quotaQuery,
  libraries,
  activeReferenceCount,
  quotaExhausted,
  quotaLoadFailed,
}: TryOnModePanelProps) {
  const t = useTranslations('ImageTryOn');
  const { mode, setMode } = form;
  const { isBusy, setError } = task;
  const {
    person: personLibraryQuery,
    garment: garmentLibraryQuery,
    pose: poseLibraryQuery,
  } = libraries;
  const handleApplyPreset: typeof form.handleApplyPreset = preset => {
    form.handleApplyPreset(preset);
    setError(null);
  };
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            {t('modeLabel')}
          </span>
          <div
            role="group"
            aria-label={t('modeLabel')}
            className="flex rounded-md border border-border overflow-hidden"
          >
            <button
              type="button"
              aria-pressed={mode === 'product'}
              data-testid="mode-product"
              disabled={isBusy}
              onClick={() => {
                setMode('product');
                setError(null);
              }}
              className={`px-4 py-2 font-mono text-xs transition-colors ${
                mode === 'product'
                  ? 'bg-foreground text-background font-medium'
                  : 'bg-background text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('modes.product')}
            </button>
            <button
              type="button"
              aria-pressed={mode === 'inspiration'}
              data-testid="mode-inspiration"
              disabled={isBusy}
              onClick={() => {
                setMode('inspiration');
                setError(null);
              }}
              className={`px-4 py-2 font-mono text-xs transition-colors ${
                mode === 'inspiration'
                  ? 'bg-foreground text-background font-medium'
                  : 'bg-background text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('modes.inspiration')}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {quotaQuery.data && (
            <span
              data-testid="try-on-quota-badge"
              className="rounded-md border border-border bg-muted/30 px-2.5 py-1 font-mono text-xs text-foreground"
            >
              {t('quotaBadge', {
                remaining: quotaQuery.data.remaining,
                limit: quotaQuery.data.limit,
              })}
            </span>
          )}
          <span
            data-testid="try-on-reference-count"
            className="rounded-md border border-border bg-muted/20 px-2.5 py-1 font-mono text-xs text-muted-foreground"
          >
            {t('referenceCount', {
              count: activeReferenceCount,
              max: MAX_TRY_ON_REFERENCES,
            })}
          </span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {mode === 'product'
          ? t('modes.productDescription')
          : t('modes.inspirationDescription')}
      </p>
      <p className="text-[11px] font-mono text-muted-foreground">
        {t('referenceLimitHint')}
      </p>

      {/* 快速体验灵感预设条 */}
      <TryOnPresetsBar
        personLibrary={personLibraryQuery.data ?? []}
        garmentLibrary={garmentLibraryQuery.data ?? []}
        poseLibrary={poseLibraryQuery.data ?? []}
        disabled={isBusy}
        onApplyPreset={handleApplyPreset}
      />

      {quotaExhausted && (
        <div
          role="alert"
          data-testid="try-on-quota-exhausted"
          className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {t('quotaExhausted')}
        </div>
      )}

      {quotaLoadFailed && (
        <div
          role="alert"
          data-testid="try-on-quota-error"
          className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {t('quotaLoadError')}
        </div>
      )}
    </div>
  );
}
