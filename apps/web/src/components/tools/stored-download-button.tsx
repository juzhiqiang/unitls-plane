'use client';

import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { downloadStoredFile } from '@/lib/files/file-download';

interface StoredFileDownloadButtonProps {
  fileId: string;
  filename?: string;
  disabled?: boolean;
}

export function StoredFileDownloadButton({
  fileId,
  filename,
  disabled,
}: StoredFileDownloadButtonProps) {
  const t = useTranslations('ToolsShared');

  return (
    <button
      type="button"
      onClick={() => downloadStoredFile(fileId, filename)}
      disabled={disabled || !fileId}
      aria-label={filename ? t('downloadFile', { filename }) : t('download')}
      className="inline-flex items-center gap-2 px-4 h-9 text-sm font-mono bg-foreground text-background rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
    >
      <Download className="h-4 w-4" strokeWidth={1.5} />
      {t('download')}
    </button>
  );
}
