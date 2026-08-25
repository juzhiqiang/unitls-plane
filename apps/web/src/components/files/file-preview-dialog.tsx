'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Download, ExternalLink } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatBytes } from '@/lib/format';
import {
  buildFileDownloadUrl,
  downloadStoredFile,
} from '@/lib/files/file-download';
import { canPreviewFile, getFilePreviewKind } from '@/lib/files/preview';

const PdfResultPreview = dynamic(
  () =>
    import('@/components/tools/pdf-result-preview').then(
      mod => mod.PdfResultPreview
    ),
  { ssr: false }
);

export interface PreviewTargetFile {
  id: string;
  filename: string;
  mimeType: string;
  originalSize: number;
}

export interface FilePreviewDialogProps {
  file: PreviewTargetFile | null;
  open: boolean;
  onClose: () => void;
  /** 深链场景下按 id 拉取文件详情，尚未返回时展示加载态。 */
  isLoading?: boolean;
  /** 文件不存在、无权访问或已删除。 */
  isMissing?: boolean;
}

/** 把 PDF 拉成 File，交给已有的 pdf.js 预览组件渲染。 */
function usePdfPreviewFile(file: PreviewTargetFile | null) {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setPdfFile(null);
    setFailed(false);
    if (!file || getFilePreviewKind(file.mimeType) !== 'pdf') return;

    const controller = new AbortController();

    fetch(buildFileDownloadUrl(file.id), {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        setPdfFile(
          new File([blob], file.filename, { type: 'application/pdf' })
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });

    return () => controller.abort();
  }, [file]);

  return { pdfFile, failed };
}

export function FilePreviewDialog({
  file,
  open,
  onClose,
  isLoading = false,
  isMissing = false,
}: FilePreviewDialogProps) {
  const t = useTranslations('FilesTool');
  const tUnits = useTranslations('Common.units');
  const locale = useLocale();
  const [imageFailed, setImageFailed] = useState(false);
  const { pdfFile, failed: pdfFailed } = usePdfPreviewFile(file);

  useEffect(() => {
    setImageFailed(false);
  }, [file]);

  const kind = file ? getFilePreviewKind(file.mimeType) : 'none';
  const previewable = file ? canPreviewFile(file) : false;
  const inlineUrl = file ? buildFileDownloadUrl(file.id) : '';

  return (
    <Dialog open={open} onOpenChange={next => !next && onClose()}>
      <DialogContent
        closeLabel={t('previewClose')}
        aria-label={file ? file.filename : t('previewTitle')}
      >
        <div className="flex items-start justify-between gap-3 pr-8">
          <div className="min-w-0">
            <DialogTitle className="truncate">
              {file?.filename ?? t('previewTitle')}
            </DialogTitle>
            <DialogDescription className="mt-1 truncate">
              {file
                ? `${file.mimeType} · ${formatBytes(file.originalSize, tUnits, locale)}`
                : t('previewTitle')}
            </DialogDescription>
          </div>
          {file && (
            <div className="flex shrink-0 items-center gap-1">
              <a
                href={inlineUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('previewOpenInNewTab')}
                title={t('previewOpenInNewTab')}
                className="p-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                <ExternalLink className="h-4 w-4" strokeWidth={1.5} />
              </a>
              <button
                type="button"
                onClick={() => downloadStoredFile(file.id, file.filename)}
                aria-label={t('downloadFile', { filename: file.filename })}
                title={t('download')}
                className="p-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                <Download className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
          )}
        </div>

        <div className="min-h-[220px] overflow-auto">
          {isLoading && (
            <p className="py-12 text-center text-xs font-mono text-muted-foreground">
              {t('previewLoading')}
            </p>
          )}

          {!isLoading && (isMissing || !file) && (
            <p className="py-12 text-center text-xs font-mono text-muted-foreground">
              {t('previewMissing')}
            </p>
          )}

          {!isLoading && file && !previewable && (
            <p className="py-12 text-center text-xs font-mono text-muted-foreground">
              {kind === 'none' ? t('previewUnsupported') : t('previewTooLarge')}
            </p>
          )}

          {!isLoading && file && previewable && kind === 'image' && (
            <div className="flex items-center justify-center rounded border border-border bg-muted/10 p-2">
              {imageFailed ? (
                <p className="py-12 text-center text-xs font-mono text-muted-foreground">
                  {t('previewFailed')}
                </p>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={inlineUrl}
                  alt={file.filename}
                  onError={() => setImageFailed(true)}
                  className="max-h-[70vh] w-auto max-w-full object-contain"
                />
              )}
            </div>
          )}

          {!isLoading && file && previewable && kind === 'pdf' && (
            <>
              {pdfFile && (
                <PdfResultPreview
                  file={pdfFile}
                  label={file.filename}
                  previousLabel={t('previewPreviousPage')}
                  nextLabel={t('previewNextPage')}
                  pageIndicator={(page, total) =>
                    t('previewPageIndicator', { page, total })
                  }
                  thumbnailLabel={page => t('previewThumbnail', { page })}
                  loadingLabel={t('previewLoading')}
                />
              )}
              {!pdfFile && (
                <p className="py-12 text-center text-xs font-mono text-muted-foreground">
                  {pdfFailed ? t('previewFailed') : t('previewLoading')}
                </p>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
