'use client';

import {
  useRef,
  useState,
  useCallback,
  type ClipboardEvent,
  type DragEvent,
} from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Eye, Image as ImageIcon, RotateCcw, Upload, X } from 'lucide-react';
import { formatBytes } from '@/lib/format';
import { useObjectUrl } from '@/hooks/use-object-url';
import { ImageViewerModal } from '@/components/tools/image-viewer-modal';

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

  const [isDragging, setIsDragging] = useState(false);
  const [isZoomOpen, setIsZoomOpen] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | File[] | null) => {
      const first = files?.[0];
      if (!first) return;
      if (first.size > maxFileSize) {
        onOversizeError?.(maxSizeText);
        return;
      }
      onFileChange(first);
    },
    [maxFileSize, maxSizeText, onFileChange, onOversizeError]
  );

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!disabled) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    if (disabled) return;
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      handleFiles(event.dataTransfer.files);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const items = event.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item && item.type.startsWith('image/')) {
        const pastedFile = item.getAsFile();
        if (pastedFile) {
          event.preventDefault();
          handleFiles([pastedFile]);
          return;
        }
      }
    }
  };

  return (
    <div
      tabIndex={0}
      onPaste={handlePaste}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="space-y-4 rounded-lg border border-border bg-card p-4 focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-all"
    >
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
        <div
          onClick={() => !disabled && inputRef.current?.click()}
          className={`group flex flex-col items-center justify-center gap-2.5 rounded-lg border-2 border-dashed py-8 px-4 text-center cursor-pointer transition-all ${
            isDragging
              ? 'border-foreground bg-accent/20 scale-[1.01]'
              : 'border-border/70 bg-muted/10 hover:border-foreground/50 hover:bg-muted/20'
          } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-background border border-border group-hover:scale-105 group-hover:border-foreground/40 transition-all">
            <Upload className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
          </div>

          <div className="space-y-1">
            <button
              type="button"
              disabled={disabled}
              onClick={e => {
                e.stopPropagation();
                inputRef.current?.click();
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {actionLabel}
            </button>
            <p className="text-xs text-muted-foreground pt-1">
              {isDragging ? t('dropzoneDropPrompt') : t('clickToUpload')}
            </p>
          </div>

          <div className="flex flex-col items-center gap-1 pt-1 font-mono text-[11px] text-muted-foreground">
            <span>{t('personDropzoneHint', { size: maxSizeText })}</span>
            <span className="text-[10px] opacity-75">{t('pasteHint')}</span>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3">
          <div className="flex items-center gap-3 min-w-0">
            {previewUrl ? (
              <div
                role="button"
                tabIndex={0}
                title={t('viewFullImage')}
                onClick={() => setIsZoomOpen(true)}
                onKeyDown={e => e.key === 'Enter' && setIsZoomOpen(true)}
                className="group/thumb relative h-20 w-20 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border bg-white"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt={file.name}
                  className="h-full w-full object-contain transition-transform group-hover/thumb:scale-105"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover/thumb:opacity-100 transition-opacity">
                  <Eye className="h-5 w-5 text-white" />
                </div>
              </div>
            ) : (
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md border border-border bg-muted/30">
                <ImageIcon className="h-6 w-6 text-muted-foreground" />
              </div>
            )}

            <div className="min-w-0 space-y-1.5">
              <p
                className="truncate text-sm font-medium text-foreground"
                title={file.name}
              >
                {t('selectedFile', {
                  filename: file.name,
                  size: formatBytes(file.size, tUnits, locale),
                })}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => inputRef.current?.click()}
                  className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
                >
                  <RotateCcw className="h-3 w-3" />
                  {t('replaceImage')}
                </button>
                {previewUrl && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setIsZoomOpen(true)}
                    className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
                  >
                    <Eye className="h-3 w-3" />
                    {t('viewFullImage')}
                  </button>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            aria-label={t('removeFile')}
            data-testid={`remove-upload-${role}`}
            disabled={disabled}
            onClick={() => onFileChange(null)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* 图片放大预览模态框 */}
      {previewUrl && (
        <ImageViewerModal
          src={previewUrl}
          alt={file?.name ?? actionLabel}
          isOpen={isZoomOpen}
          onClose={() => setIsZoomOpen(false)}
        />
      )}
    </div>
  );
}
