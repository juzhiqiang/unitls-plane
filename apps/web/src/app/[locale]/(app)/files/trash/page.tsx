'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import {
  useTrashedFiles,
  useRestoreFile,
  usePermanentDeleteFile,
  useBatchRestoreFiles,
  useBatchPermanentDeleteFiles,
  useEmptyTrash,
} from '@/hooks/api/use-files';
import { ArrowLeft, RotateCcw, Trash2, AlertTriangle, X } from 'lucide-react';

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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  const { data, isLoading } = useTrashedFiles({ page, limit: 12 });
  const restoreFile = useRestoreFile();
  const permanentDelete = usePermanentDeleteFile();
  const batchRestore = useBatchRestoreFiles();
  const batchPermanentDelete = useBatchPermanentDeleteFiles();
  const emptyTrash = useEmptyTrash();

  const files = data?.files ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 12);
  const allVisibleSelected =
    files.length > 0 && files.every(file => selected.has(file.id));

  const resetConfirmations = () => {
    setConfirmId(null);
    setConfirmBatchDelete(false);
    setConfirmEmpty(false);
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    resetConfirmations();
  };

  const selectAll = () => {
    setSelected(
      allVisibleSelected ? new Set() : new Set(files.map(file => file.id))
    );
    resetConfirmations();
  };

  const clearSelection = () => {
    setSelected(new Set());
    resetConfirmations();
  };

  const handleBatchRestore = async () => {
    if (selected.size === 0) return;
    await batchRestore.mutateAsync(Array.from(selected));
    clearSelection();
  };

  const handleBatchPermanentDelete = async () => {
    if (selected.size === 0) return;
    if (!confirmBatchDelete) {
      setConfirmBatchDelete(true);
      setConfirmId(null);
      setConfirmEmpty(false);
      return;
    }

    await batchPermanentDelete.mutateAsync(Array.from(selected));
    clearSelection();
  };

  const handleEmptyTrash = async () => {
    if (!confirmEmpty) {
      setConfirmEmpty(true);
      setConfirmId(null);
      setConfirmBatchDelete(false);
      return;
    }

    await emptyTrash.mutateAsync();
    clearSelection();
  };

  const handlePermanentDelete = async (id: string) => {
    if (confirmId === id) {
      await permanentDelete.mutateAsync(id);
      setSelected(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setConfirmId(null);
      return;
    }

    setConfirmId(id);
    setConfirmBatchDelete(false);
    setConfirmEmpty(false);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/files"
            className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
          </Link>
          <h1 className="text-lg font-medium">{t('trash')}</h1>
        </div>
        {files.length > 0 && (
          <button
            type="button"
            onClick={() => void handleEmptyTrash()}
            disabled={emptyTrash.isPending}
            className={`inline-flex items-center gap-1.5 px-3 h-8 text-xs font-mono border rounded-md transition-colors disabled:opacity-50 ${
              confirmEmpty
                ? 'text-destructive border-destructive/50 bg-destructive/10'
                : 'text-muted-foreground border-border hover:text-destructive hover:border-destructive/30'
            }`}
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            {confirmEmpty ? t('confirmEmptyTrash') : t('emptyTrash')}
          </button>
        )}
      </div>

      {/* Warning bar */}
      <div className="flex items-center gap-3 px-4 py-3 border border-border rounded-md">
        <AlertTriangle
          className="h-4 w-4 text-muted-foreground shrink-0"
          strokeWidth={1.5}
        />
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

      {/* Batch actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 py-2 flex-wrap">
          <span className="text-xs font-mono text-muted-foreground">
            {t('selected', { count: selected.size })}
          </span>
          <button
            type="button"
            onClick={() => void handleBatchRestore()}
            disabled={batchRestore.isPending}
            className="inline-flex items-center gap-1.5 px-3 h-7 text-xs font-mono text-muted-foreground border border-border rounded-md hover:text-foreground hover:border-foreground/20 transition-colors disabled:opacity-50"
          >
            <RotateCcw className="h-3 w-3" strokeWidth={1.5} />
            {t('restoreSelected')}
          </button>
          <button
            type="button"
            onClick={() => void handleBatchPermanentDelete()}
            disabled={batchPermanentDelete.isPending}
            className={`inline-flex items-center gap-1.5 px-3 h-7 text-xs font-mono border rounded-md transition-colors disabled:opacity-50 ${
              confirmBatchDelete
                ? 'text-destructive border-destructive/50 bg-destructive/10'
                : 'text-destructive border-destructive/30 hover:bg-destructive/10'
            }`}
          >
            <Trash2 className="h-3 w-3" strokeWidth={1.5} />
            {confirmBatchDelete
              ? t('confirmBatchPermanentDelete')
              : t('deleteSelectedPermanently')}
          </button>
          <button
            type="button"
            onClick={clearSelection}
            aria-label={t('clearSelection')}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </div>
      )}

      {/* File list */}
      {files.length > 0 && (
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <div className="min-w-[720px] sm:min-w-0">
            {/* Table header */}
            <div className="grid grid-cols-[24px_minmax(160px,1fr)_90px_90px_100px_180px] gap-3 px-3 py-2 border-b border-border">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={selectAll}
                aria-label={t('selectAll')}
                className="h-3.5 w-3.5 rounded-none border border-border bg-transparent checked:bg-accent checked:border-accent mt-0.5"
              />
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
                {t('deleted')}
              </span>
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider text-right">
                {t('actions')}
              </span>
            </div>
            {/* Table rows */}
            {files.map(file => (
              <div
                key={file.id}
                className={`grid grid-cols-[24px_minmax(160px,1fr)_90px_90px_100px_180px] gap-3 px-3 py-3 border-b border-border transition-colors ${
                  selected.has(file.id) ? 'bg-accent/5' : 'hover:bg-muted/40'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(file.id)}
                  onChange={() => toggleSelect(file.id)}
                  aria-label={t('selectFile', { filename: file.filename })}
                  className="h-3.5 w-3.5 rounded-none border border-border bg-transparent checked:bg-accent checked:border-accent mt-0.5"
                />
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
                  {file.deletedAt ? formatDate(file.deletedAt) : '-'}
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
                    onClick={() => void handlePermanentDelete(file.id)}
                    disabled={permanentDelete.isPending}
                    className={`inline-flex items-center gap-1 px-2 h-6 text-[10px] font-mono rounded transition-colors disabled:opacity-50 ${
                      confirmId === file.id
                        ? 'text-destructive border border-destructive/50 bg-destructive/10'
                        : 'text-muted-foreground border border-border hover:text-destructive hover:border-destructive/30'
                    }`}
                  >
                    <Trash2 className="h-3 w-3" strokeWidth={1.5} />
                    {confirmId === file.id
                      ? t('confirmPermanentDeleteShort')
                      : t('permanentDelete')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
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
