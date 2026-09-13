'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Pencil, Sparkles } from 'lucide-react';
import type { GenerationMessageGroup } from './types';
import type { TaskOutputPreview } from '@/hooks/api/use-task-output';
import { useFilePreviewUrl } from '@/hooks/api/use-file-preview';
import { useRetryTask } from '@/hooks/api/use-tasks';
import { ImageGenerateCompare } from '@/components/tools/image-generate-compare';
import { ImageLightbox } from './image-lightbox';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

/**
 * 服务端错误码 → 文案键。与页面提交路径的映射保持同一份语义。
 * 映射表里的错误码用本地化文案;不在表里的失败优先展示服务端已脱敏的真实原因。
 */
export const MESSAGE_ERROR_KEYS: Record<string, string> = {
  AI_IMAGE_DAILY_LIMIT_EXCEEDED: 'quotaExceeded',
  AI_IMAGE_CONTENT_REJECTED: 'contentRejected',
  AI_IMAGE_NOT_CONFIGURED: 'notConfigured',
  AI_IMAGE_PROVIDER_UNAVAILABLE: 'providerUnavailable',
};

/**
 * 服务端脱敏原因是固定英文模板(见 apps/api 的 image-generation.service),
 * 前端按模板反解成母语文案:状态码只用于分类,不出现在用户界面里。
 * 认不出的原因(如网关的中文报错原文)原样展示。
 */
const UPSTREAM_HTTP_RE = /^Upstream returned HTTP (\d{3})(?::\s*(.+))?$/;
const REQUEST_FAILED_RE = /^Request failed:\s*(.+)$/;
const FETCH_IMAGE_FAILED_RE =
  /^Failed to download generated image(?::\s*(.+))?$/;

/** 上游原因文本(小写)→ 本地化句子键;按序取第一个命中的。 */
const REASON_PHRASE_KEYS: Array<[string[], string]> = [
  [['bad gateway'], 'reasonBadGateway'],
  [['gateway time-out', 'gateway timeout', 'timeout'], 'reasonGatewayTimeout'],
  [['service unavailable'], 'reasonServiceUnavailable'],
  [['internal server error', 'server error'], 'reasonInternalError'],
  [['too many requests', 'rate limit', 'ratelimit'], 'reasonRateLimited'],
  [
    ['api key', 'apikey', 'invalid token', 'unauthorized', 'authentication'],
    'reasonAuthFailed',
  ],
  [
    ['insufficient', 'balance', 'arrears', '欠费', '余额'],
    'reasonInsufficientBalance',
  ],
];

/** 只有状态码、没有可读原因时按状态码归类。 */
const STATUS_REASON_KEYS: Record<string, string> = {
  '401': 'reasonAuthFailed',
  '403': 'reasonAuthFailed',
  '429': 'reasonRateLimited',
  '500': 'reasonInternalError',
  '502': 'reasonBadGateway',
  '503': 'reasonServiceUnavailable',
  '504': 'reasonGatewayTimeout',
};

function classifyReasonKey(
  status: string,
  reason: string | undefined
): string | undefined {
  if (reason) {
    const lowered = reason.toLowerCase();
    const hit = REASON_PHRASE_KEYS.find(([markers]) =>
      markers.some(marker => lowered.includes(marker))
    );
    if (hit) return hit[1];
    // 有原文但认不出类别:原文就是原因,直接展示。
    return undefined;
  }
  return STATUS_REASON_KEYS[status];
}

/** 失败格子的展示描述:文案键或直接文本(reasonKey 是本地化句子键)。 */
export interface FailureDisplay {
  key?: string;
  values?: Record<string, string>;
  reasonKey?: string;
  detail?: string;
}

/** 失败格子的文案:专属映射 → 本地化;否则翻译/展示服务端真实原因;再兜底通用失败。 */
export function describeFailure(
  errorCode: string | undefined,
  errorMessage: string | undefined
): FailureDisplay {
  const mapped = errorCode ? MESSAGE_ERROR_KEYS[errorCode] : undefined;
  if (mapped) return { key: mapped };

  if (errorMessage) {
    const upstream = UPSTREAM_HTTP_RE.exec(errorMessage);
    if (upstream) {
      const [, status = '', rawReason] = upstream;
      const reason = rawReason?.trim();
      const reasonKey = classifyReasonKey(status, reason);
      // 状态码只进分类,不给用户看。
      if (reasonKey) return { reasonKey };
      if (reason) return { detail: reason };
      return { key: 'upstreamHttpBare' };
    }
    if (errorMessage === 'Upstream request timed out') {
      return { key: 'upstreamTimeout' };
    }
    const requestFailed = REQUEST_FAILED_RE.exec(errorMessage);
    if (requestFailed) {
      return {
        key: 'upstreamFailed',
        values: { reason: requestFailed[1] ?? '' },
      };
    }
    if (errorMessage === 'Unexpected response format from the provider') {
      return { key: 'unexpectedResponse' };
    }
    if (
      errorMessage === 'No reference image was available for this generation'
    ) {
      return { key: 'missingReference' };
    }
    if (
      errorMessage ===
      'Inpaint requires the base image and the edited selection'
    ) {
      return { key: 'inpaintInputsMissing' };
    }
    const fetchFailed = FETCH_IMAGE_FAILED_RE.exec(errorMessage);
    if (fetchFailed) {
      const raw = fetchFailed[1]?.trim();
      // 取回失败常只带状态码("Failed to download generated image: 502"):按状态归类。
      const asStatus = raw && /^\d{3}$/.test(raw) ? raw : undefined;
      const reasonKey = asStatus
        ? STATUS_REASON_KEYS[asStatus]
        : classifyReasonKey('', raw);
      if (reasonKey) return { reasonKey };
      return { key: 'imageFetchFailed', values: { reason: raw ?? '' } };
    }
    // 无法识别的原因(内容策略附带的上游原文等)直接展示。
    return { detail: errorMessage };
  }
  return { key: 'failed' };
}

/** 把 describeFailure 的结果渲染成本地化文本。 */
export function useFailureText(): (
  errorCode: string | undefined,
  errorMessage: string | undefined
) => string {
  const t = useTranslations('ImageGenerate');
  return (errorCode, errorMessage) => {
    const failure = describeFailure(errorCode, errorMessage);
    if (failure.detail) return failure.detail;
    if (failure.reasonKey) return t(failure.reasonKey);
    const key = failure.key ?? 'failed';
    const values = { ...failure.values };
    return Object.keys(values).length ? t(key, values) : t(key);
  };
}

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

/** 用户侧头像:优先账号头像,回落到名称/邮箱首字母。 */
function UserAvatar({ user }: { user?: MessageUser }) {
  const t = useTranslations('ImageGenerate');
  const initial = (user?.name || user?.email || 'U').charAt(0).toUpperCase();
  return (
    <Avatar className="h-7 w-7 shrink-0">
      {user?.image ? (
        <AvatarImage src={user.image} alt={user.name || t('userAvatarAlt')} />
      ) : null}
      <AvatarFallback className="text-[11px]">{initial}</AvatarFallback>
    </Avatar>
  );
}

/** AI 侧头像:与空态一致的星芒标记。 */
function AssistantAvatar() {
  const t = useTranslations('ImageGenerate');
  return (
    <span
      aria-label={t('assistantAvatarAlt')}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background"
    >
      <Sparkles className="h-3.5 w-3.5" />
    </span>
  );
}

export interface MessageUser {
  name?: string | null;
  email?: string | null;
  image?: string | null;
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
  /** 当前登录用户,用于右侧头像。 */
  user?: MessageUser;
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
        className="h-14 w-14 object-cover"
      />
    </button>
  );
}

/**
 * 一条生成消息:右侧用户提示词(带账号头像),左侧 AI 结果(带助手头像)。
 *
 * - 结果图以固定小缩略排布(不再占满气泡宽度),点击放大预览;
 * - inpaint 结果点击弹「修改前后对比」(底图 vs 结果,滑动对比);
 * - 编辑入口常显,失败任务行内展示错误与「重新生成」(retry 落回同一会话)。
 */
export function GenerationMessage({
  group,
  previews,
  onRetryFetch,
  onEditImage,
  user,
}: GenerationMessageProps) {
  const t = useTranslations('ImageGenerate');
  const failureText = useFailureText();
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
    <article className="space-y-3">
      {/* 用户消息:头像在右,气泡在左侧紧邻。 */}
      <div className="flex items-start justify-end gap-2">
        <div className="max-w-[min(32rem,80%)] space-y-2 rounded-lg rounded-tr-sm bg-muted/60 px-3.5 py-2.5 text-sm leading-relaxed">
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
        <UserAvatar user={user} />
      </div>

      {/* AI 结果:头像在左,气泡在右侧紧邻。 */}
      <div className="flex items-start justify-start gap-2">
        <AssistantAvatar />
        <div className="max-w-[min(36rem,85%)] space-y-2 rounded-lg rounded-tl-sm border border-border bg-muted/30 px-3 py-2.5">
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

          {/* 结果缩略图:固定 8rem 方格流式排列,点击放大。 */}
          <div className="flex flex-wrap gap-2">
            {(group.tasks ?? []).map((task, index) => {
              const preview = previews[task.taskId];

              if (task.status === 'failed') {
                return (
                  <div
                    key={task.taskId}
                    className="flex h-32 w-32 flex-col items-center justify-center gap-1 rounded-md border border-destructive/50 bg-destructive/10 px-2 py-2 text-center text-[11px]"
                  >
                    <span className="text-foreground">
                      {failureText(task.errorCode, task.errorMessage)}
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
                    className="flex h-32 w-32 items-center justify-center rounded-md bg-muted/40"
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
                  className="group relative h-32 w-32 overflow-hidden rounded-md border border-border"
                >
                  <button
                    type="button"
                    aria-label={
                      group.mode === 'inpaint'
                        ? t('compareEditedTitle')
                        : t('enlargeResult')
                    }
                    onClick={() => {
                      // inpaint 无条件开对比弹窗:底图预览是异步取回的,若在这里等它,
                      // 首次点击会误入放大预览分支,用户要再点一次才能看到对比。
                      if (group.mode === 'inpaint') {
                        setCompareOpen(true);
                      } else {
                        setLightbox({
                          url: preview.url!,
                          alt: t('resultMeta', { index: String(index + 1) }),
                        });
                      }
                    }}
                    className="block h-full w-full cursor-zoom-in"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={preview.url}
                      alt={t('resultMeta', { index: String(index + 1) })}
                      className="h-full w-full object-cover"
                    />
                  </button>

                  {/* 编辑与下载:小图上用图标位,常显以便触摸设备可达。 */}
                  {onEditImage && (
                    <button
                      type="button"
                      aria-label={t('editImage')}
                      title={t('editImage')}
                      onClick={() => onEditImage(preview.url!)}
                      className="absolute left-1 top-1 rounded-md bg-background/90 p-1 text-foreground shadow-sm hover:bg-background"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                  <a
                    href={preview.url}
                    download={`ai-image-${index + 1}.png`}
                    aria-label={t('downloadImage')}
                    title={t('downloadImage')}
                    className="absolute bottom-1 right-1 rounded-md bg-background/90 px-1.5 py-0.5 text-[10px] text-foreground shadow-sm hover:bg-background"
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

      {/* inpaint 结果的前后对比弹窗:底图 vs 结果。底图异步取回,未就绪时给占位。 */}
      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent
          closeLabel={t('lightboxClose')}
          className="max-h-[92vh] max-w-[92vw] overflow-hidden p-3 lg:max-w-4xl"
        >
          <DialogTitle className="sr-only">
            {t('compareEditedTitle')}
          </DialogTitle>
          {baseImageForCompare && firstUrl ? (
            <ImageGenerateCompare
              beforeUrl={baseImageForCompare}
              afterUrl={firstUrl}
              title={t('compareEditedTitle')}
            />
          ) : (
            <div
              role="status"
              className="flex h-64 items-center justify-center"
            >
              <span className="animate-pulse font-mono text-xs uppercase tracking-wider text-muted-foreground">
                {t('resultFetching')}
              </span>
            </div>
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
