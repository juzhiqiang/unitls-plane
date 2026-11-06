'use client';

import { AlertTriangle, RotateCcw, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { recoveryMessageKey } from '@/lib/tasks/recovery-errors';

interface FailureRecoveryPanelProps {
  message: string;
  errorCode?: string;
  onRetry?: () => void;
  onRetryDownload?: () => Promise<unknown>;
  onReset?: () => void;
}

export function FailureRecoveryPanel({
  message,
  errorCode,
  onRetry,
  onRetryDownload,
  onReset,
}: FailureRecoveryPanelProps) {
  const t = useTranslations('ToolShell.failure');
  const recovery = useTranslations('TaskRecovery');
  const resourceLimited =
    errorCode === 'TASK_RESOURCE_LIMIT_EXCEEDED' ||
    message.startsWith('Task resource limit exceeded:');
  const reason = recoveryMessageKey(message);
  const retrying = useRef(false);
  const [downloading, setDownloading] = useState(false);
  const downloadMode = !!onRetryDownload || downloading;

  const retryDownload = async () => {
    if (!onRetryDownload || retrying.current) return;
    retrying.current = true;
    setDownloading(true);
    try {
      await onRetryDownload();
    } finally {
      retrying.current = false;
      setDownloading(false);
    }
  };

  const showRecent = () => {
    const panel = document.getElementById('recent-tasks');
    if (panel instanceof HTMLDetailsElement) {
      panel.open = true;
      panel.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      panel.querySelector('summary')?.focus();
    }
  };

  return (
    <section className="rounded-md border border-destructive/30 bg-card p-4">
      <div className="flex gap-3">
        <AlertTriangle
          className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
          strokeWidth={1.5}
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium text-destructive">
            {reason
              ? recovery('checkOriginal')
              : downloadMode
                ? recovery('downloadFailedTitle')
                : t('title')}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {resourceLimited
              ? recovery('resourceLimit')
              : reason
                ? recovery(reason)
                : downloadMode
                  ? recovery('downloadError')
                  : message}
          </p>
          {errorCode && (
            <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-destructive">
              {errorCode}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {reason ? (
              <button
                type="button"
                onClick={showRecent}
                className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-mono hover:bg-muted/40"
              >
                {recovery('viewRecent')}
              </button>
            ) : downloadMode ? (
              <button
                type="button"
                onClick={() => {
                  void retryDownload();
                }}
                disabled={downloading}
                className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-mono hover:bg-muted/40 disabled:opacity-50"
              >
                {recovery(downloading ? 'downloading' : 'download')}
              </button>
            ) : (
              !resourceLimited &&
              onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs font-mono hover:bg-muted/40"
                >
                  <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />
                  {t('retry')}
                </button>
              )
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
