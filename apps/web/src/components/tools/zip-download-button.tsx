'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import JSZip from 'jszip';
import { useTranslations } from 'next-intl';

export interface ZipDownloadButtonProps {
  files: File[];
  zipName?: string;
  className?: string;
  disabled?: boolean;
}

export function ZipDownloadButton({
  files,
  zipName = 'compressed.zip',
  className,
  disabled,
}: ZipDownloadButtonProps) {
  const [building, setBuilding] = useState(false);
  const t = useTranslations('ToolsShared');

  const handleDownload = async () => {
    if (files.length === 0 || building) return;
    setBuilding(true);
    try {
      const zip = new JSZip();
      const used = new Map<string, number>();
      for (const file of files) {
        let name = file.name;
        const count = used.get(name) ?? 0;
        if (count > 0) {
          const dot = name.lastIndexOf('.');
          const base = dot > 0 ? name.slice(0, dot) : name;
          const ext = dot > 0 ? name.slice(dot) : '';
          name = `${base}-${count}${ext}`;
        }
        used.set(file.name, count + 1);
        zip.file(name, file);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = zipName;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBuilding(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={disabled || building || files.length === 0}
      className={`inline-flex items-center gap-2 px-4 h-9 text-sm font-mono bg-foreground text-background rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 ${className ?? ''}`}
    >
      <Download className="h-4 w-4" strokeWidth={1.5} />
      {building ? t('zipBuilding') : t('downloadZipCount', { count: files.length })}
    </button>
  );
}
