'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy, Download, RotateCcw, Sparkles } from 'lucide-react';
import { ResultPanel } from '@/components/tools/result-panel';
import { ImageViewerModal } from '@/components/tools/image-viewer-modal';
import { ImageGenerateCompare } from '@/components/tools/image-generate-compare';
import {
  buildFileDownloadUrl,
  downloadStoredFile,
} from '@/lib/files/file-download';
import type { TryOnTask } from './useTryOnTask';

interface TryOnResultProps {
  task: Pick<
    TryOnTask,
    'effectiveTask' | 'isBusy' | 'setError' | 'handleRegenerate'
  >;
  comparisonBeforeUrl: string;
  hasGarmentPreview: boolean;
}

export function TryOnResult({
  task,
  comparisonBeforeUrl,
  hasGarmentPreview,
}: TryOnResultProps) {
  const t = useTranslations('ImageTryOn');
  const { effectiveTask, isBusy, setError, handleRegenerate } = task;
  // 结果展示模式：单图 vs 滑动卷帘对比
  const [resultViewMode, setResultViewMode] = useState<'single' | 'compare'>(
    'single'
  );
  const [copied, setCopied] = useState(false);

  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerSrc, setViewerSrc] = useState('');

  // 复制结果图到剪贴板
  const handleCopyResultImage = async () => {
    if (!effectiveTask?.outputFileId) return;
    try {
      const url = buildFileDownloadUrl(effectiveTask.outputFileId);
      const res = await fetch(url);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type || 'image/png']: blob }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t('copyFailed'));
    }
  };

  return (
    <>
      {/* 成功结果面板：标明 AI 生成及试衣模式 + 单图 / 滑动对比切换 */}
      {effectiveTask?.status === 'completed' && effectiveTask.outputFileId && (
        <ResultPanel
          title={t('resultTitle')}
          description={
            effectiveTask.mode === 'product'
              ? t('resultProductDisclaimer')
              : t('resultInspirationDisclaimer')
          }
          meta={[
            {
              label: t('aiGeneratedBadge'),
              value:
                effectiveTask.mode === 'product'
                  ? t('resultModeProductBadge')
                  : t('resultModeInspirationBadge'),
            },
          ]}
          preview={
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    data-testid="result-ai-badge"
                    className="inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-foreground"
                  >
                    <Sparkles className="h-3 w-3" />
                    {t('aiGeneratedBadge')}
                  </span>
                  <span
                    data-testid="result-mode-badge"
                    className="inline-flex items-center rounded border border-border bg-background px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
                  >
                    {effectiveTask.mode === 'product'
                      ? t('resultModeProductBadge')
                      : t('resultModeInspirationBadge')}
                  </span>
                </div>

                {/* 视图切换：单图预览 vs 滑动卷帘对比 */}
                {comparisonBeforeUrl && (
                  <div className="flex rounded-md border border-border overflow-hidden text-xs font-mono">
                    <button
                      type="button"
                      onClick={() => setResultViewMode('single')}
                      className={`px-3 py-1 transition-colors ${
                        resultViewMode === 'single'
                          ? 'bg-foreground text-background font-medium'
                          : 'bg-background text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {t('resultViewSingle')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setResultViewMode('compare')}
                      className={`px-3 py-1 transition-colors ${
                        resultViewMode === 'compare'
                          ? 'bg-foreground text-background font-medium'
                          : 'bg-background text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {t('resultViewCompare')}
                    </button>
                  </div>
                )}
              </div>

              {resultViewMode === 'compare' && comparisonBeforeUrl ? (
                <div className="pt-2">
                  <ImageGenerateCompare
                    beforeUrl={comparisonBeforeUrl}
                    afterUrl={buildFileDownloadUrl(effectiveTask.outputFileId)}
                    title={
                      hasGarmentPreview
                        ? t('compareOriginalGarment')
                        : t('compareOriginalPerson')
                    }
                  />
                </div>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={buildFileDownloadUrl(effectiveTask.outputFileId)}
                  alt={t('resultPreviewAlt')}
                  className="mx-auto max-h-96 w-auto rounded-md border border-border object-contain cursor-pointer hover:opacity-90"
                  onClick={() => {
                    setViewerSrc(
                      buildFileDownloadUrl(effectiveTask.outputFileId!)
                    );
                    setViewerOpen(true);
                  }}
                />
              )}
            </div>
          }
          action={
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="try-on-download"
                onClick={() => downloadStoredFile(effectiveTask.outputFileId!)}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-foreground px-4 font-mono text-xs text-background transition-opacity hover:opacity-90"
              >
                <Download className="h-3.5 w-3.5" />
                {t('download')}
              </button>
              <button
                type="button"
                onClick={() => void handleCopyResultImage()}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 font-mono text-xs text-foreground transition-colors hover:border-foreground"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                    <span>{t('copySuccess')}</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>{t('copyImage')}</span>
                  </>
                )}
              </button>
              <button
                type="button"
                data-testid="try-on-regenerate"
                disabled={isBusy}
                onClick={handleRegenerate}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 font-mono text-xs text-foreground transition-colors hover:border-foreground disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t('regenerate')}
              </button>
            </div>
          }
        />
      )}

      {/* 图片查看器 */}
      <ImageViewerModal
        src={viewerSrc}
        alt={t('resultPreviewAlt')}
        isOpen={viewerOpen}
        onClose={() => setViewerOpen(false)}
      />
    </>
  );
}
