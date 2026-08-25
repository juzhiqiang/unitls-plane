'use client';

import { useEffect, useState } from 'react';
import { FileText, Image as ImageIcon, Type } from 'lucide-react';
import { buildFileDownloadUrl } from '@/lib/files/file-download';
import { shouldRenderThumbnail } from '@/lib/files/preview';

export interface FileThumbnailProps {
  file: {
    id: string;
    filename: string;
    mimeType: string;
    originalSize: number;
  };
  className?: string;
}

function TypeIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith('image/')) {
    return (
      <ImageIcon
        className="h-6 w-6 text-muted-foreground"
        strokeWidth={1.5}
        aria-hidden
      />
    );
  }
  if (mimeType === 'application/pdf') {
    return (
      <FileText
        className="h-6 w-6 text-muted-foreground"
        strokeWidth={1.5}
        aria-hidden
      />
    );
  }
  return (
    <Type
      className="h-6 w-6 text-muted-foreground"
      strokeWidth={1.5}
      aria-hidden
    />
  );
}

/**
 * 列表卡片缩略图：小图直接内联加载原图，其余显示类型图标。
 * 服务端缩略图尚未提供，因此这里用体积阈值控制带宽。
 */
export function FileThumbnail({ file, className }: FileThumbnailProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [file.id]);

  const showImage = shouldRenderThumbnail(file) && !failed;

  return (
    <div
      className={`flex h-24 items-center justify-center overflow-hidden rounded border border-border bg-muted/10 ${className ?? ''}`}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={buildFileDownloadUrl(file.id)}
          alt={file.filename}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-contain"
        />
      ) : (
        <TypeIcon mimeType={file.mimeType} />
      )}
    </div>
  );
}
