'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import {
  useTrashedFiles,
  useRestoreFile,
  usePermanentDeleteFile,
  type FileRecord,
} from '@/hooks/api/use-files';
import { ArrowLeft, RotateCcw, Trash2, AlertTriangle } from 'lucide-react';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function TrashPage() {
  const t = useTranslations('FilesTool');
  const [page, setPage] = useState(1);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const { data, isLoading } = useTrashedFiles({ page, limit: 12 });
  const restoreFile = useRestoreFile();
  const permanentDelete = usePermanentDeleteFile();

  const files = data?.files ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 12);

  const handlePermanentDelete = (id: string) => {
    if (confirmId === id) {
      permanentDelete.mutate(id);
      setConfirmId(null);
    } else {
      setConfirmId(id);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/files"
          className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
        </Link>
        <div>
          <h1 className="text-lg font-medium">{t('trash')}</h1>
        </div>
      </div>

      {/* Warning bar */}
      <div className="flex items-center gap-3 px-4 py-3 border border-border rounded-md">
        <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0" strokeWidth={1.5} />
        <span className="text-xs font-mono text-muted-foreground">
          {t('trashWarning')}
        </span>
      </div>

      {/* Empty state */}
      {files.length === 0 && !isLoading && (
        <p className="text-sm text-muted-foreground py-12 text-center">
          {t('trashEmpty')}
        </p>
      )}

      {/* File list */}
      {files.length > 0 && (
        <div>
          {/* Table header */}
          <div className="grid grid-cols-[1fr_100px_100px_100px_140px] gap-3 px-3 py-2 border-b border-border">
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
              {t('filename')}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
              {t('type')}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
              {t('size')}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
              Deleted
            </span>
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider text-right">
              {t('actions')}
            </span>
          </div>
          {/* Table rows */}
          {files.map((file) => (
            <div
              key={file.id}
              className="grid grid-cols-[1fr_100px_100px_100px_140px] gap-3 px-3 py-3 border-b border-border hover:bg-muted/40 transition-colors"
            >
              <span className="text-sm truncate" title={file.filename}>
                {file.filename}
              </span>
              <span className="text-[11px] font-mono text-muted-foreground uppercase">
                {file.mimeType.split('/')[1]}
              </span>
              <span className="text-[11px] font-mono text-muted-foreground">
                {formatFileSize(file.originalSize)}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {file.deletedAt ? formatDate(file.deletedAt) : '—'}
              </span>
              <div className="flex justify-end gap-1">
                <button
                  type="button"
                  onClick={() => restoreFile.mutate(file.id)}
                  disabled={restoreFile.isPending}
                  className="inline-flex items-center gap-1 px-2 h-6 text-[10px] font-mono text-muted-foreground border border-border rounded hover:text-foreground hover:border-foreground/20 transition-colors disabled:opacity-50"
                >
                  <RotateCcw className="h-3 w-3" strokeWidth={1.5} />
                  {t('restore')}
                </button>
                <button
                  type="button"
                  onClick={() => handlePermanentDelete(file.id)}
                  disabled={permanentDelete.isPending}
                  className={`inline-flex items-center gap-1 px-2 h-6 text-[10px] font-mono rounded transition-colors disabled:opacity-50 ${
                    confirmId === file.id
                      ? 'text-destructive border border-destructive/50 bg-destructive/10'
                      : 'text-muted-foreground border border-border hover:text-destructive hover:border-destructive/30'
                  }`}
                >
                  <Trash2 className="h-3 w-3" strokeWidth={1.5} />
                  {confirmId === file.id ? t('confirmPermanentDelete') : t('permanentDelete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPage(p)}
              className={`h-7 w-7 text-xs font-mono rounded-md transition-colors ${
                p === page
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground border border-border'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
