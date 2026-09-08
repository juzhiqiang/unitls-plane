'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Pencil } from 'lucide-react';
import type { GenerationMessageGroup } from './types';
import type { TaskOutputPreview } from '@/hooks/api/use-task-output';
import { useFilePreviewUrl } from '@/hooks/api/use-file-preview';
import { useRetryTask } from '@/hooks/api/use-tasks';
import { ImageGenerateCompare } from '@/components/tools/image-generate-compare';
import { ImageLightbox } from './image-lightbox';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';

/** 服务端错误码 → 文案键。与页面提交路径的映射保持同一份语义。 */
export const MESSAGE_ERROR_KEYS: Record<string, string> = {
  AI_IMAGE_DAILY_LIMIT_EXCEEDED: 'quotaExceeded',
  AI_IMAGE_CONTENT_REJECTED: 'contentRejected',
  AI_IMAGE_NOT_CONFIGURED: 'notConfigured',
  AI_IMAGE_PROVIDER_UNAVAILABLE: 'providerUnavailable',
};

/** batch 级错误(配额耗尽、建任务失败等)以系统气泡挂在消息流末尾。 */
export function SystemNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  const t = useTranslations('ImageGenerate');
  return (
    <div
      role="alert"
      className="mx-auto max-w-md rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-foreground"
    >
      <p>{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {t('retrySubmit')}
        </button>
      )}
    </div>
  );
}

interface GenerationMessageProps {
  group: GenerationMessageGroup;
  /** taskId → 产物预览状态(url 存在即可显示)。 */
  previews: Record<string, TaskOutputPreview>;
  /** 单张取回失败时给「重试取回」而不是重新生成。 */
  onRetryFetch: (taskId: string, outputFileId: string) => void;
  /**
   * 局部重绘入口:常显(来源不支持时由页面给切换引导),undefined = 完全不出
   * (只有一种情况:连来源列表都还没回来)。
   */
  onEditImage?: (url: string) => void;
}

/** 消息里一张参考图的缩略(点击放大)。 */
function ReferenceThumb({
  fileId,
  onOpen,
}: {
  fileId: string;
  onOpen: (url: string) => void;
}) {
  const url = useFilePreviewUrl(fileId);
  const t = useTranslations('ImageGenerate');
  if (!url) return null;
  return (
    <button
      type="button"
      aria-label={t('enlargeReference')}
      onClick={() => onOpen(url)}
      className="block overflow-hidden rounded-md border border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={t('sourcePreviewAlt')}
        className="h-16 w-16 object-cover"
      />
    </button>
  );
}

/**
 * 一条生成消息:提示词气泡(右,图生图/融合带参考图缩略)→ 结果气泡(左)。
 *
 * - 文生图/图生图结果:点击放大预览;
 * - inpaint 结果:点击弹出「修改前后对比」(底图 vs 结果,滑动对比);
 * - 来源支持局部重绘时,每张完成图 hover 出「编辑」入口,进蒙版编辑器。
 * 失败任务行内展示错误与「重新生成」(走 retry 端点,重试任务落回同一会话)。
 */
export function GenerationMessage({
  group,
  previews,
  onRetryFetch,
  onEditImage,
}: GenerationMessageProps) {
  const t = useTranslations('ImageGenerate');
  const retryTask = useRetryTask();
  const [compareOpen, setCompareOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ url: string; alt: string } | null>(
    null
  );

  const completedTasks = (group.tasks ?? []).filter(
    task => task.status === 'completed'
  );
  const firstUrl = previews[completedTasks[0]?.taskId ?? '']?.url;
  const baseImageForCompare = useFilePreviewUrl(
    group.mode === 'inpaint' ? group.referenceFileIds[0] : undefined
  );
  const referenceUrlForCompare = useFilePreviewUrl(
    group.mode === 'image_to_image' ? group.referenceFileIds[0] : undefined
  );
  const showCompareToggle = Boolean(
    group.mode === 'image_to_image' && referenceUrlForCompare && firstUrl
  );

  return (
    <article className="space-y-2">
      {/* 提示词气泡:右对齐的「用户消息」。 */}
      <div className="flex justify-end">
        <div className="max-w-[min(36rem,90%)] space-y-2 rounded-lg bg-muted/60 px-4 py-3 text-sm leading-relaxed">
          {group.referenceFileIds.length > 0 && group.mode !== 'inpaint' && (
            <div className="flex flex-wrap gap-2">
              {group.referenceFileIds.map(fileId => (
                <ReferenceThumb
                  key={fileId}
                  fileId={fileId}
                  onOpen={url =>
                    setLightbox({ url, alt: t('sourcePreviewAlt') })
                  }
                />
              ))}
            </div>
          )}
          <p className="whitespace-pre-wrap break-words">{group.prompt}</p>
        </div>
      </div>

      {/* 结果气泡:左对齐的「助手消息」。 */}
      <div className="flex justify-start">
        <div className="w-full max-w-[min(44rem,100%)] space-y-2 rounded-lg border border-border bg-muted/30 px-3 py-3">
          {showCompareToggle && (
            <button
              type="button"
              aria-pressed={compareOpen}
              onClick={() => setCompareOpen(value => !value)}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {t('compareToggle')}
            </button>
          )}

          <div
            className={
              (group.tasks?.length ?? 0) > 2
                ? 'grid grid-cols-2 gap-2'
                : 'flex flex-wrap gap-2'
            }
          >
            {(group.tasks ?? []).map((task, index) => {
              const preview = previews[task.taskId];

              if (task.status === 'failed') {
                return (
                  <div
                    key={task.taskId}
                    className="flex aspect-square min-h-24 flex-1 flex-col items-center justify-center gap-1 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs"
                  >
                    <span className="text-foreground">
                      {t(
                        MESSAGE_ERROR_KEYS[task.errorCode ?? ''] ?? 'failed'
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => retryTask.mutate(task.taskId)}
                      className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      {t('retryGenerate')}
                    </button>
                  </div>
                );
              }

              if (!preview?.url) {
                return (
                  <div
                    key={task.taskId}
                    role="status"
                    aria-live="polite"
                    className="flex aspect-square min-h-24 flex-1 items-center justify-center rounded-md bg-muted/40"
                  >
                    <span className="animate-pulse font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {task.status === 'completed'
                        ? t('resultFetching')
                        : t('generating')}
                    </span>
                  </div>
                );
              }

              return (
                <figure
                  key={task.taskId}
                  className="group relative flex-1 overflow-hidden rounded-md border border-border"
                >
                  <button
                    type="button"
                    aria-label={
                      group.mode === 'inpaint'
                        ? t('compareEditedTitle')
                        : t('enlargeResult')
                    }
                    onClick={() => {
                      if (group.mode === 'inpaint' && baseImageForCompare) {
                        setCompareOpen(true);
                      } else {
                        setLightbox({
                          url: preview.url!,
                          alt: t('resultMeta', { index: String(index + 1) }),
                        });
                      }
                    }}
                    className="block w-full cursor-zoom-in"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={preview.url}
                      alt={t('resultMeta', { index: String(index + 1) })}
                      className="h-auto w-full object-contain"
                    />
                  </button>

                  {/* 局部重绘入口:常显(触摸设备没有 hover,来源不支持时点击给引导)。 */}
                  {onEditImage && (
                    <button
                      type="button"
                      aria-label={t('editImage')}
                      title={t('editImage')}
                      onClick={() => onEditImage(preview.url!)}
                      className="absolute left-2 top-2 rounded-md bg-background/90 p-1.5 text-foreground shadow-sm transition-opacity hover:bg-background focus-visible:opacity-100"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}

                  <a
                    href={preview.url}
                    download={`ai-image-${index + 1}.png`}
                    className="absolute bottom-2 right-2 rounded-md bg-background/90 px-2 py-1 text-xs text-foreground shadow-sm transition-opacity hover:bg-background focus-visible:opacity-100"
                  >
                    {t('downloadImage')}
                  </a>
                </figure>
              );
            })}
          </div>

          {/* 产物取回失败的行内重试(区别于生成失败:图已生成,只补一次下载)。 */}
          {(group.tasks ?? []).map(task => {
            if (
              task.status === 'completed' &&
              task.outputFileId &&
              previews[task.taskId]?.state === 'error'
            ) {
              return (
                <button
                  key={task.taskId}
                  type="button"
                  onClick={() => onRetryFetch(task.taskId, task.outputFileId!)}
                  className="block text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  {t('resultFetchFailed')} · {t('retryFetch')}
                </button>
              );
            }
            return null;
          })}
        </div>
      </div>

      {/* inpaint 结果的前后对比弹窗:底图 vs 结果。 */}
      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent
          closeLabel={t('lightboxClose')}
          className="max-h-[92vh] max-w-[92vw] overflow-hidden p-3 lg:max-w-4xl"
        >
          <DialogTitle className="sr-only">
            {t('compareEditedTitle')}
          </DialogTitle>
          {baseImageForCompare && firstUrl && (
            <ImageGenerateCompare
              beforeUrl={baseImageForCompare}
              afterUrl={firstUrl}
              title={t('compareEditedTitle')}
            />
          )}
        </DialogContent>
      </Dialog>

      <ImageLightbox
        url={lightbox?.url ?? null}
        alt={lightbox?.alt ?? ''}
        onClose={() => setLightbox(null)}
      />
    </article>
  );
}
