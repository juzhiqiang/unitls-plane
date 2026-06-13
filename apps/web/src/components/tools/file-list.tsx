'use client';

import { AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { formatBytes } from '@/lib/format';

export type FileStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface FileItem {
  file: File;
  result?: File;
  status: FileStatus;
  error?: string;
}

export interface FileListProps {
  items: FileItem[];
  onRemove?: (index: number) => void;
  disabled?: boolean;
}

function StatusIcon({ status }: { status: FileStatus }) {
  if (status === 'done') {
    return (
      <CheckCircle2 className="h-4 w-4 text-emerald-500" strokeWidth={1.5} />
    );
  }

  if (status === 'failed') {
    return (
      <AlertCircle className="h-4 w-4 text-destructive" strokeWidth={1.5} />
    );
  }

  if (status === 'processing') {
    return (
      <Loader2 className="h-4 w-4 animate-spin text-accent" strokeWidth={1.5} />
    );
  }

  return <div className="h-2 w-2 rounded-full bg-muted-foreground/40" />;
}

export function FileList({ items, onRemove, disabled }: FileListProps) {
  const t = useTranslations('ToolsShared');
  const tUnits = useTranslations('Common.units');
  const locale = useLocale();

  if (items.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="hidden grid-cols-[24px_1fr_88px_88px_64px_28px] gap-3 border-b border-border bg-muted/30 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:grid">
        <span />
        <span>{t('fileList.filename')}</span>
        <span className="text-right">{t('fileList.original')}</span>
        <span className="text-right">{t('fileList.compressed')}</span>
        <span className="text-right">{t('fileList.saved')}</span>
        <span />
      </div>

      <div className="divide-y divide-border">
        {items.map((item, i) => {
          const original = item.file.size;
          const result = item.result?.size;
          const savedPct =
            result !== undefined && original > 0
              ? `${((1 - result / original) * 100).toFixed(1)}%`
              : '-';
          const removeLabel = t('fileList.removeFile', {
            filename: item.file.name,
          });

          return (
            <div
              key={`${item.file.name}-${i}`}
              className="px-3 py-2 font-mono text-xs"
            >
              <div className="flex items-start gap-2 sm:hidden">
                <div className="shrink-0 pt-0.5">
                  <StatusIcon status={item.status} />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div
                    className="truncate text-foreground"
                    title={item.file.name}
                  >
                    {item.file.name}
                  </div>
                  {item.error && (
                    <div className="break-words text-destructive">
                      {item.error}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                    <span className="tabular-nums">
                      {formatBytes(original, tUnits, locale)}
                    </span>
                    {result !== undefined && (
                      <>
                        <span className="tabular-nums text-foreground">
                          {'->'} {formatBytes(result, tUnits, locale)}
                        </span>
                        <span className="tabular-nums text-emerald-500">
                          {savedPct}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                {onRemove && (
                  <button
                    type="button"
                    onClick={() => onRemove(i)}
                    disabled={disabled || item.status === 'processing'}
                    aria-label={removeLabel}
                    className="-mr-1 shrink-0 p-1 text-muted-foreground transition-colors hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                )}
              </div>

              <div className="hidden grid-cols-[24px_1fr_88px_88px_64px_28px] items-center gap-3 sm:grid">
                <StatusIcon status={item.status} />
                <div className="truncate" title={item.file.name}>
                  <span className="text-foreground">{item.file.name}</span>
                  {item.error && (
                    <span className="ml-2 text-destructive">{item.error}</span>
                  )}
                </div>
                <span className="text-right tabular-nums text-muted-foreground">
                  {formatBytes(original, tUnits, locale)}
                </span>
                <span className="text-right tabular-nums text-foreground">
                  {result !== undefined
                    ? formatBytes(result, tUnits, locale)
                    : '-'}
                </span>
                <span className="text-right tabular-nums text-emerald-500">
                  {savedPct}
                </span>
                {onRemove && (
                  <button
                    type="button"
                    onClick={() => onRemove(i)}
                    disabled={disabled || item.status === 'processing'}
                    aria-label={removeLabel}
                    className="text-muted-foreground transition-colors hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
