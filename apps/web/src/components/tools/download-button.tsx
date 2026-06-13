'use client';

import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';

export interface DownloadButtonProps {
  file: File;
  className?: string;
}

export function DownloadButton({ file, className }: DownloadButtonProps) {
  const t = useTranslations('ToolsShared');

  const handleDownload = () => {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      aria-label={t('downloadFile', { filename: file.name })}
      className={`inline-flex items-center gap-2 px-4 h-9 text-sm font-mono bg-foreground text-background rounded-md hover:opacity-90 transition-opacity ${className ?? ''}`}
    >
      <Download className="h-4 w-4" strokeWidth={1.5} />
      {t('download')}
    </button>
  );
}
