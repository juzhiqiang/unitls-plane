'use client';

import { AlertTriangle, RotateCcw, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface FailureRecoveryPanelProps {
  message: string;
  errorCode?: string;
  onRetry?: () => void;
  onReset?: () => void;
}

export function FailureRecoveryPanel({
  message,
  errorCode,
  onRetry,
  onReset,
}: FailureRecoveryPanelProps) {
  const t = useTranslations('ToolShell.failure');

  return (
    <section className="rounded-md border border-destructive/30 bg-card p-4">
      <div className="flex gap-3">
        <AlertTriangle
          className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
          strokeWidth={1.5}
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium text-destructive">{t('title')}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{message}</p>
          {errorCode && (
            <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-destructive">
              {errorCode}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs font-mono hover:bg-muted/40"
              >
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />
                {t('retry')}
              </button>
            )}
            {onReset && (
              <button
                type="button"
                onClick={onReset}
                className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs font-mono hover:bg-muted/40"
              >
                <Upload className="h-3.5 w-3.5" strokeWidth={1.5} />
                {t('replaceFile')}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
