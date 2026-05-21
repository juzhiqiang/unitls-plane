'use client';

import { useDropzone, type Accept } from 'react-dropzone';
import { Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FileDropzoneProps {
  accept?: Accept;
  maxSize?: number;
  multiple?: boolean;
  disabled?: boolean;
  onDrop: (files: File[]) => void;
  className?: string;
  hint?: string;
}

export function FileDropzone({
  accept,
  maxSize,
  multiple = false,
  disabled = false,
  onDrop,
  className,
  hint,
}: FileDropzoneProps) {
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
          disabled && 'opacity-50 cursor-not-allowed',
        )}
      >
        <input {...getInputProps()} />
        <Upload className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
        <div className="text-sm text-foreground">
          {isDragActive ? '松开以上传' : '点击或拖拽文件到此处'}
        </div>
        {hint && (
          <div className="text-xs font-mono text-muted-foreground">{hint}</div>
        )}
      </div>
      {fileRejections.length > 0 && (
        <div className="mt-3 text-xs text-destructive font-mono">
          {fileRejections.map(({ file, errors }) => (
            <div key={file.name}>
              {file.name}: {errors.map((e) => e.message).join(', ')}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
