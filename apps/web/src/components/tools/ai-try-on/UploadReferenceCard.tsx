'use client';

import { useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Upload, X } from 'lucide-react';
import { formatBytes } from '@/lib/format';
import { useObjectUrl } from '@/hooks/use-object-url';

interface UploadReferenceCardProps {
  role: 'person' | 'garment';
  file: File | null;
  actionLabel: string;
  maxFileSize: number;
  disabled?: boolean;
  onFileChange: (file: File | null) => void;
  onOversizeError?: (maxSizeFormatted: string) => void;
}

export function UploadReferenceCard({
  role,
  file,
  actionLabel,
  maxFileSize,
  disabled = false,
  onFileChange,
  onOversizeError,
}: UploadReferenceCardProps) {
  const t = useTranslations('ImageTryOn');
  const tUnits = useTranslations('Common.units');
  const locale = useLocale();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previewUrl = useObjectUrl(file);
  const maxSizeText = formatBytes(maxFileSize, tUnits, locale);

  const handleFiles = (files: FileList | File[] | null) => {
    const first = files?.[0];
    if (!first) return;
    if (first.size > maxFileSize) {
      onOversizeError?.(maxSizeText);
      return;
    }
    onFileChange(first);
  };

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-5">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        aria-label={actionLabel}
        data-testid={`upload-input-${role}`}
        disabled={disabled}
        onChange={event => {
          handleFiles(event.target.files);
          event.target.value = '';
        }}
        className="sr-only"
      />

      {!file ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border/60 hover:border-foreground/40 transition-colors py-8 text-center">
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            {actionLabel}
          </button>
          <p className="text-xs text-muted-foreground">
            {t('personDropzoneHint', { size: maxSizeText })}
          </p>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 p-3">
          <div className="flex items-center gap-3 min-w-0">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt={file.name}
                className="h-20 w-20 shrink-0 rounded border border-border object-cover"
              />
            ) : null}
            <div className="min-w-0 space-y-1">
              <p className="truncate text-sm font-medium text-foreground">
                {t('selectedFile', {
                  filename: file.name,
                  size: formatBytes(file.size, tUnits, locale),
                })}
              </p>
              <button
                type="button"
                disabled={disabled}
                onClick={() => inputRef.current?.click()}
                className="font-mono text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
              >
                {actionLabel}
              </button>
            </div>
          </div>

          <button
            type="button"
            aria-label={t('removeFile')}
            data-testid={`remove-upload-${role}`}
            disabled={disabled}
            onClick={() => onFileChange(null)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

