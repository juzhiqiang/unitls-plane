'use client';

import { useTranslations } from 'next-intl';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  buildFileDownloadUrl,
  downloadStoredFile,
} from '@/lib/files/file-download';

interface ImageLightboxProps {
  /** 打开时展示的文件 id;null 时对话框关闭。原图在打开时才按需请求。 */
  fileId: string | null;
  alt: string;
  onClose: () => void;
}

/**
 * 图片放大预览:点击缩略图/结果图打开,点击遮罩或关闭按钮收起。
 * 基于现有 Dialog 原语,不引入新依赖。
 *
 * 网格里展示的是 320px 缩略图;点击放大时这里才按 fileId 请求原图
 * (`/download` inline),清晰度不打折,也不必为看不看的图预取原图。
 */
export function ImageLightbox({ fileId, alt, onClose }: ImageLightboxProps) {
  const t = useTranslations('ImageGenerate');

  return (
    <Dialog open={Boolean(fileId)} onOpenChange={open => !open && onClose()}>
      <DialogContent
        closeLabel={t('lightboxClose')}
        className="flex max-h-[92vh] max-w-[92vw] flex-col items-center gap-2 overflow-hidden p-3 lg:max-w-5xl"
      >
        <DialogTitle className="sr-only">{alt}</DialogTitle>
        {fileId && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={buildFileDownloadUrl(fileId)}
            alt={alt}
            className="max-h-[82vh] w-auto max-w-full rounded-md object-contain"
          />
        )}
        {fileId && (
          <button
            type="button"
            onClick={() => downloadStoredFile(fileId)}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {t('downloadImage')}
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
