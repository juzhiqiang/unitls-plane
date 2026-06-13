'use client';

import { useDropzone, type Accept } from 'react-dropzone';
import { Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export interface FileDropzoneProps {
  accept?: Accept;
  maxSize?: number;
  multiple?: boolean;
  disabled?: boolean;
  onDrop: (files: File[]) => void;
  className?: string;
  hint?: string;
  processingLabel?: string;
}

function formatMaxSize(bytes?: number): string | null {
  if (!bytes) return null;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${Math.round(mb)} MB max`;
  return `${Math.round(bytes / 1024)} KB max`;
}

export function FileDropzone({
  accept,
  maxSize,
  multiple = false,
  disabled = false,
  onDrop,
  className,
  hint,
  processingLabel,
}: FileDropzoneProps) {
  const t = useTranslations('ToolsShared');
  const maxSizeLabel = formatMaxSize(maxSize);
  const { getRootProps, getInputProps, isDragActive, fileRejections } =
    useDropzone({
      accept,
      maxSize,
      multiple,
      disabled,
      onDrop,
    });

  return (
    <div className={className}>
      <div
        {...getRootProps()}
        className={cn(
          'border border-dashed border-border rounded-md px-6 py-16',
          'flex flex-col items-center justify-center gap-3',
          'cursor-pointer transition-colors',
          'hover:bg-muted/40',
          isDragActive && 'bg-muted/60 border-accent',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <input {...getInputProps()} />
        <Upload className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
        <div className="text-sm text-foreground">
          {isDragActive ? t('dropzoneRelease') : t('dropzonePrompt')}
        </div>
        {(hint || maxSizeLabel || processingLabel) && (
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-mono text-muted-foreground">
            {hint && <span>{hint}</span>}
            {maxSizeLabel && <span>{maxSizeLabel}</span>}
            {processingLabel && <span>{processingLabel}</span>}
          </div>
        )}
      </div>
      {fileRejections.length > 0 && (
        <div className="mt-3 text-xs text-destructive font-mono">
          {fileRejections.map(({ file, errors }) => (
            <div key={file.name}>
              {file.name}: {errors.map(e => e.message).join(', ')}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
