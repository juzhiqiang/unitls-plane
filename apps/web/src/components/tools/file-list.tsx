'use client';

import { X, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function StatusIcon({ status }: { status: FileStatus }) {
  if (status === 'done')
    return <CheckCircle2 className="h-4 w-4 text-emerald-500" strokeWidth={1.5} />;
  if (status === 'failed')
    return <AlertCircle className="h-4 w-4 text-destructive" strokeWidth={1.5} />;
  if (status === 'processing')
    return <Loader2 className="h-4 w-4 text-accent animate-spin" strokeWidth={1.5} />;
  return <div className="h-2 w-2 rounded-full bg-muted-foreground/40" />;
}

export function FileList({ items, onRemove, disabled }: FileListProps) {
  if (items.length === 0) return null;

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <div className="grid grid-cols-[24px_1fr_88px_88px_64px_28px] gap-3 px-3 py-2 border-b border-border text-[10px] font-mono text-muted-foreground uppercase tracking-wider bg-muted/30">
        <span></span>
        <span>文件名</span>
        <span className="text-right">原始</span>
        <span className="text-right">压缩后</span>
        <span className="text-right">节省</span>
        <span></span>
      </div>
      <div className="divide-y divide-border">
        {items.map((item, i) => {
          const original = item.file.size;
          const result = item.result?.size;
          const savedPct =
            result !== undefined && original > 0
              ? ((1 - result / original) * 100).toFixed(1) + '%'
              : '—';
          return (
            <div
              key={`${item.file.name}-${i}`}
              className="grid grid-cols-[24px_1fr_88px_88px_64px_28px] gap-3 px-3 py-2 items-center text-xs font-mono"
            >
              <StatusIcon status={item.status} />
              <div className="truncate" title={item.file.name}>
                <span className="text-foreground">{item.file.name}</span>
                {item.error && (
                  <span className="ml-2 text-destructive">{item.error}</span>
                )}
              </div>
              <span className="text-right tabular-nums text-muted-foreground">
                {formatSize(original)}
              </span>
              <span className="text-right tabular-nums text-foreground">
                {result !== undefined ? formatSize(result) : '—'}
              </span>
              <span className="text-right tabular-nums text-emerald-500">
                {savedPct}
              </span>
              {onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  disabled={disabled || item.status === 'processing'}
                  className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
