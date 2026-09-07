'use client';

import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';

interface ImageLightboxProps {
  /** 打开时展示的图片;undefined 时对话框关闭。 */
  url: string | null;
  alt: string;
  onClose: () => void;
}

/**
 * 图片放大预览:点击缩略图/结果图打开,点击遮罩或关闭按钮收起。
 * 基于现有 Dialog 原语,不引入新依赖。
 */
export function ImageLightbox({ url, alt, onClose }: ImageLightboxProps) {
  const t = useTranslations('ImageGenerate');

  return (
    <Dialog open={Boolean(url)} onOpenChange={open => !open && onClose()}>
      <DialogContent
        closeLabel={t('lightboxClose')}
        className="flex max-h-[92vh] max-w-[92vw] flex-col items-center gap-2 overflow-hidden p-3 lg:max-w-5xl"
      >
        <DialogTitle className="sr-only">{alt}</DialogTitle>
        {url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={alt}
            className="max-h-[82vh] w-auto max-w-full rounded-md object-contain"
          />
        )}
        {url && (
          <a
            href={url}
            download
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {t('downloadImage')}
          </a>
        )}
      </DialogContent>
    </Dialog>
  );
}
