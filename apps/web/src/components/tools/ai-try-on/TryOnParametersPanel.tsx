'use client';

import { useTranslations } from 'next-intl';
import { Sparkles, X } from 'lucide-react';
import { TRY_ON_PROMPT_MAX_LENGTH } from './types';
import type { TryOnWorkbench } from './useTryOnWorkbench';

const SCENE_CHIP_KEYS = [
  'whiteStudio',
  'greyBackdrop',
  'softLighting',
  'cityStreet',
  'afternoonCafe',
  'coastalDaylight',
] as const;

type TryOnParametersPanelProps = Pick<
  TryOnWorkbench,
  | 'form'
  | 'task'
  | 'models'
  | 'promptTooLong'
  | 'requiredApiFailed'
  | 'quotaLoadFailed'
  | 'canSubmit'
  | 'progressLabel'
  | 'submitGuideMessage'
>;

export function TryOnParametersPanel({
  form,
  task,
  models,
  promptTooLong,
  requiredApiFailed,
  quotaLoadFailed,
  canSubmit,
  progressLabel,
  submitGuideMessage,
}: TryOnParametersPanelProps) {
  const t = useTranslations('ImageTryOn');
  const {
    promptAddition,
    setPromptAddition,
    size,
    setSize,
    quality,
    setQuality,
    model,
    setModel,
  } = form;
  const { isBusy, setError, handleSubmit } = task;
  const handleToggleSceneChip = (value: string) => {
    form.handleToggleSceneChip(value);
    setError(null);
  };
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{t('promptSectionTitle')}</h2>
        {promptAddition && (
          <button
            type="button"
            disabled={isBusy}
            onClick={() => setPromptAddition('')}
            className="inline-flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <X className="h-3 w-3" />
            {t('clearPrompt')}
          </button>
        )}
      </div>

      {/* 场景与光影快捷标签推荐 */}
      <div className="space-y-2">
        <span className="font-mono text-[11px] text-muted-foreground">
          {t('sceneChipsLabel')}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {SCENE_CHIP_KEYS.map(key => {
            const label = t(`workbench.sceneChips.${key}.label`);
            const val = t(`workbench.sceneChips.${key}.value`);
            const isActive = promptAddition.includes(val);
            return (
              <button
                key={key}
                type="button"
                disabled={isBusy}
                onClick={() => handleToggleSceneChip(val)}
                className={`rounded-full px-2.5 py-1 text-xs transition-all ${
                  isActive
                    ? 'border border-foreground bg-foreground text-background font-medium'
                    : 'border border-border bg-muted/30 text-muted-foreground hover:border-foreground/50 hover:text-foreground'
                } disabled:opacity-50`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label
            htmlFor="try-on-prompt-addition"
            className="text-xs text-muted-foreground"
          >
            {t('promptLabel')}
          </label>
          <span
            className={`font-mono text-[11px] tabular-nums ${
              promptTooLong ? 'text-destructive' : 'text-muted-foreground'
            }`}
          >
            {t('promptCounter', {
              count: promptAddition.trim().length,
              max: TRY_ON_PROMPT_MAX_LENGTH,
            })}
          </span>
        </div>
        <textarea
          id="try-on-prompt-addition"
          rows={2}
          value={promptAddition}
          disabled={isBusy}
          placeholder={t('promptPlaceholder')}
          onChange={event => {
            setPromptAddition(event.target.value);
            setError(null);
          }}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none disabled:opacity-50"
        />
        {promptTooLong && (
          <p role="alert" className="text-xs text-destructive">
            {t('errors.promptTooLong')}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <label
            htmlFor="try-on-size"
            className="text-xs text-muted-foreground"
          >
            {t('sizeLabel')}
          </label>
          <select
            id="try-on-size"
            value={size}
            disabled={isBusy}
            onChange={event => setSize(event.target.value)}
            className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground"
          >
            <option value="auto">{t('sizes.auto')}</option>
            <option value="1024x1024">{t('sizes.square')}</option>
            <option value="1024x1536">{t('sizes.portrait')}</option>
            <option value="1536x1024">{t('sizes.landscape')}</option>
          </select>
        </div>

        <div className="space-y-1">
          <label
            htmlFor="try-on-quality"
            className="text-xs text-muted-foreground"
          >
            {t('qualityLabel')}
          </label>
          <select
            id="try-on-quality"
            value={quality}
            disabled={isBusy}
            onChange={event =>
              setQuality(event.target.value as 'auto' | 'standard' | 'high')
            }
            className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground"
          >
            <option value="high">{t('qualities.high')}</option>
            <option value="standard">{t('qualities.standard')}</option>
            <option value="auto">{t('qualities.auto')}</option>
          </select>
        </div>

        {models.length > 1 && (
          <div className="space-y-1">
            <label
              htmlFor="try-on-model"
              className="text-xs text-muted-foreground"
            >
              {t('modelLabel')}
            </label>
            <select
              id="try-on-model"
              value={model || models[0]?.model || ''}
              disabled={isBusy}
              onChange={event => setModel(event.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground"
            >
              {models.map(item => (
                <option key={item.model} value={item.model}>
                  {item.model}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {requiredApiFailed && !quotaLoadFailed && (
        <div
          role="alert"
          data-testid="try-on-required-library-error"
          className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {t('errors.requiredLibraryFailed')}
        </div>
      )}

      <div className="space-y-2 pt-1">
        <button
          type="button"
          data-testid="try-on-submit"
          disabled={!canSubmit}
          onClick={() => void handleSubmit()}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-foreground font-mono text-sm text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" />
          {isBusy ? progressLabel : t('submit')}
        </button>

        {/* 提交按钮下方防呆提示与快捷键说明 */}
        <div className="text-center font-mono text-xs">
          {submitGuideMessage ? (
            <span className="text-amber-600 dark:text-amber-400">
              {submitGuideMessage}
            </span>
          ) : (
            <span className="text-muted-foreground/80">
              {t('submitShortcut')}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
