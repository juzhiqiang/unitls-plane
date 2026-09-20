'use client';

import { useTranslations } from 'next-intl';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

interface ImageLightboxProps {
  /** 打开时展示的图片地址(存储文件的 /download 或本地参考图的 blob URL);null 时关闭。 */
  src: string | null;
  alt: string;
  /** 下载链接。存储文件传 attachment URL,本地参考图传其 blob URL;省略则不显示下载。 */
  downloadHref?: string;
  onClose: () => void;
}

/**
 * 图片放大预览:点击缩略图/结果图打开,点击遮罩或关闭按钮收起。
 * 基于现有 Dialog 原语,不引入新依赖。
 *
 * 只负责展示传入的地址,不关心它是存储文件还是本地 blob:
 * - 生图结果:调用方传 /download(inline)原图,点开时才请求,清晰度不打折;
 * - 本地参考图:调用方传 useObjectUrls 生成的 blob URL。
 */
export function ImageLightbox({
  src,
  alt,
  downloadHref,
  onClose,
}: ImageLightboxProps) {
  const t = useTranslations('ImageGenerate');

  return (
    <Dialog open={Boolean(src)} onOpenChange={open => !open && onClose()}>
      <DialogContent
        closeLabel={t('lightboxClose')}
        className="flex max-h-[92vh] max-w-[92vw] flex-col items-center gap-2 overflow-hidden p-3 lg:max-w-5xl"
      >
        <DialogTitle className="sr-only">{alt}</DialogTitle>
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={alt}
            className="max-h-[82vh] w-auto max-w-full rounded-md object-contain"
          />
        )}
        {src && downloadHref && (
          <a
            href={downloadHref}
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
