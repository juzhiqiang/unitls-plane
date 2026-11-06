'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { taskReceipts, type TaskReceipt } from '@/lib/tasks/task-receipts';
import type { RecoveredTaskStatus } from '@/hooks/api/use-task-recovery';
import { ProcessingProgress } from '@/components/tools/processing-progress';
import {
  buildFileDownloadUrl,
  triggerBrowserDownload,
  downloadedFilename,
} from '@/lib/files/file-download';

const LABEL_KEYS: Record<string, string> = {
  compress: 'typeCompress',
  convert: 'typeConvert',
  image_watermark: 'typeImageWatermark',
  image_id_photo: 'typeImageIdPhoto',
  image_generate: 'typeImageGenerate',
  image_try_on: 'typeImageTryOn',
  pdf_merge: 'typePdfMerge',
  pdf_split: 'typePdfSplit',
  pdf_to_image: 'typePdfToImage',
  pdf_to_text: 'typePdfToText',
  image_to_pdf: 'typeImageToPdf',
  pdf_rotate: 'typePdfRotate',
  pdf_watermark: 'typePdfWatermark',
  pdf_encrypt: 'typePdfEncrypt',
  pdf_compress: 'typePdfCompress',
  pdf_metadata: 'typePdfMetadata',
  pdf_rearrange: 'typePdfRearrange',
  pdf_from_document: 'typePdfFromDocument',
  pdf_to_cad: 'typePdfToCad',
  font_convert: 'typeFontConvert',
};

export function TaskRecoveryRow({
  scope,
  receipt,
  status,
  now,
}: {
  scope: string;
  receipt: TaskReceipt;
  status?: RecoveredTaskStatus;
  now: number;
}) {
  const t = useTranslations('TaskRecovery');
  const taskLabels = useTranslations('TasksTool');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const downloadRef = useRef<AbortController | null>(null);
  useEffect(() => () => downloadRef.current?.abort(), []);
  const state = status?.status;
  const seconds = Math.max(0, Math.floor((now - receipt.startedAt) / 1000));
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  async function download() {
    if (!status?.outputFileId || downloadRef.current) return;
    const controller = new AbortController();
    downloadRef.current = controller;
    const timer = setTimeout(() => controller.abort(), 60_000);
    setDownloading(true);
    setDownloadError(false);
    try {
      const response = await fetch(buildFileDownloadUrl(status.outputFileId), {
        credentials: 'include',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const extension =
        (
          {
            'application/pdf': 'pdf',
            'application/zip': 'zip',
            'text/plain': 'txt',
            'image/png': 'png',
            'image/jpeg': 'jpg',
            'image/webp': 'webp',
            'image/avif': 'avif',
            'application/dxf': 'dxf',
            'font/eot': 'eot',
            'font/ttf': 'ttf',
            'font/otf': 'otf',
            'font/woff': 'woff',
            'font/woff2': 'woff2',
          } as Record<string, string>
        )[blob.type] ?? 'bin';
      const url = URL.createObjectURL(blob);
      triggerBrowserDownload(
        url,
        downloadedFilename(
          response.headers.get('Content-Disposition'),
          `result-${receipt.taskId?.slice(0, 8)}.${extension}`
        )
      );
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      if (!controller.signal.aborted || downloadRef.current === controller)
        setDownloadError(true);
    } finally {
      clearTimeout(timer);
      downloadRef.current = null;
      setDownloading(false);
    }
  }

  return (
    <li className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">
            {LABEL_KEYS[receipt.type]
              ? taskLabels(LABEL_KEYS[receipt.type])
              : t('task')}{' '}
            <span className="font-mono text-xs text-muted-foreground">
              {(receipt.taskId ?? receipt.key).slice(0, 8)}
            </span>
          </p>
          {(state === 'pending' || state === 'processing') && (
            <p className="text-xs text-muted-foreground">
              {t('elapsed', { time: elapsed })}
            </p>
          )}
        </div>
        <button
          type="button"
          className="shrink-0 text-xs text-muted-foreground underline underline-offset-4"
          onClick={() => taskReceipts.put(scope, { ...receipt, hidden: true })}
          title={t('hideHint')}
        >
          {t('hide')}
        </button>
      </div>
      {state === 'pending' || state === 'processing' ? (
        <ProcessingProgress
          progress={status?.progress ?? 0}
          stage={state === 'pending' ? 'queued' : 'processing'}
          label={t(state)}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          {t(
            state === 'completed'
              ? 'completed'
              : state === 'failed'
                ? 'failed'
                : state === 'not_found'
                  ? 'unavailable'
                  : receipt.taskId
                    ? 'checking'
                    : 'unconfirmed'
          )}
        </p>
      )}
      {state === 'failed' && status?.errorMessage && (
        <p className="break-words text-xs text-destructive">
          {status.errorMessage}
        </p>
      )}
      {state === 'completed' && status?.outputFileId && (
        <button
          type="button"
          onClick={() => {
            void download();
          }}
          disabled={downloading}
          className="text-xs font-medium text-accent underline underline-offset-4 disabled:opacity-50"
        >
          {t(downloading ? 'downloading' : 'download')}
        </button>
      )}
      {downloadError && (
        <p role="alert" className="text-xs text-destructive">
          {t('downloadError')}
        </p>
      )}
    </li>
  );
}
