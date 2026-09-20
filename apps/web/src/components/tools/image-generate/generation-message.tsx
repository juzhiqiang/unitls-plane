'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Pencil, Sparkles } from 'lucide-react';
import type { GenerationMessageGroup } from './types';
import {
  buildFileDownloadUrl,
  buildFileThumbnailUrl,
  downloadStoredFile,
} from '@/lib/files/file-download';
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

/**
 * 内容策略拒绝时,服务端可能把真实原因拼在固定模板后面
 * (`The prompt was rejected…: 抱歉，我不能…`)。剥掉前缀后如果还有原文就展示它。
 */
function contentRejectionDetail(message: string): string | undefined {
  const trimmed = message.trim();
  const prefix = 'The prompt was rejected by the provider content policy';
  if (trimmed === prefix) return undefined;
  if (trimmed.startsWith(`${prefix}:`)) {
    const rest = trimmed.slice(prefix.length + 1).trim();
    return rest || undefined;
  }
  return trimmed;
}

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
  if (mapped) {
    // 内容策略拒绝:上游有时带回中文拒绝原文("抱歉,我不能…"),
    // 这种具体原因比通用文案有用,直接展示;模板定式文案不发。
    if (errorCode === 'AI_IMAGE_CONTENT_REJECTED' && errorMessage) {
      const detail = contentRejectionDetail(errorMessage);
      if (detail) return { detail };
    }
    return { key: mapped };
  }

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
  /**
   * 局部重绘入口:常显(来源不支持时由页面给切换引导),undefined = 完全不出
   * (只有一种情况:连来源列表都还没回来)。回调收产物文件 id,页面按需取原图。
   */
  onEditImage?: (fileId: string) => void;
  /** 当前登录用户,用于右侧头像。 */
  user?: MessageUser;
}

/** 消息里一张参考图的缩略(点击放大)。走 320px 缩略图端点,不再预取原图 blob。 */
function ReferenceThumb({
  fileId,
  onOpen,
}: {
  fileId: string;
  onOpen: (fileId: string) => void;
}) {
  const t = useTranslations('ImageGenerate');
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [fileId]);
  if (failed) return null;
  return (
    <button
      type="button"
      aria-label={t('enlargeReference')}
      onClick={() => onOpen(fileId)}
      className="block overflow-hidden rounded-md border border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={buildFileThumbnailUrl(fileId)}
        alt={t('sourcePreviewAlt')}
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-14 w-14 object-cover"
      />
    </button>
  );
}

/**
 * 一张已完成结果图的缩略格子。走 320px 缩略图端点 + 原生懒加载:
 * 切进历史会话时,不在视口内的图不会立刻下载,也不再为 128px 的格子拉 3 MB 原图。
 * 取回失败时给「重试取回」,点击 bump 一个 key 给 URL 追加参数破缓存重取。
 */
function ResultThumb({ fileId, alt }: { fileId: string; alt: string }) {
  const t = useTranslations('ImageGenerate');
  const [reloadKey, setReloadKey] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    setReloadKey(0);
  }, [fileId]);

  if (failed) {
    return (
      <button
        type="button"
        onClick={() => {
          setFailed(false);
          setReloadKey(key => key + 1);
        }}
        className="flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-center text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        <span>{t('resultFetchFailed')}</span>
        <span>{t('retryFetch')}</span>
      </button>
    );
  }

  const src =
    reloadKey > 0
      ? `${buildFileThumbnailUrl(fileId)}?r=${reloadKey}`
      : buildFileThumbnailUrl(fileId);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover"
    />
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
  onEditImage,
  user,
}: GenerationMessageProps) {
  const t = useTranslations('ImageGenerate');
  const failureText = useFailureText();
  const retryTask = useRetryTask();
  const [compareOpen, setCompareOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{
    fileId: string;
    alt: string;
  } | null>(null);

  const completedTasks = (group.tasks ?? []).filter(
    task => task.status === 'completed'
  );
  // 对比弹窗要原图清晰度(纯 <img> 展示,不碰 canvas):直接用 /download inline URL。
  const firstOutputFileId = completedTasks[0]?.outputFileId;
  const firstUrl = firstOutputFileId
    ? buildFileDownloadUrl(firstOutputFileId)
    : undefined;
  const baseImageForCompare =
    group.mode === 'inpaint' && group.referenceFileIds[0]
      ? buildFileDownloadUrl(group.referenceFileIds[0])
      : undefined;
  const referenceUrlForCompare =
    group.mode === 'image_to_image' && group.referenceFileIds[0]
      ? buildFileDownloadUrl(group.referenceFileIds[0])
      : undefined;
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
                  onOpen={id =>
                    setLightbox({ fileId: id, alt: t('sourcePreviewAlt') })
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
                      disabled={
                        retryTask.isPending &&
                        retryTask.variables === task.taskId
                      }
                      className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-60"
                    >
                      {t('retryGenerate')}
                    </button>
                  </div>
                );
              }

              // 未完成或还没写回产物 id:脉动占位,图交给完成后的懒加载。
              if (task.status !== 'completed' || !task.outputFileId) {
                return (
                  <div
                    key={task.taskId}
                    role="status"
                    aria-live="polite"
                    className="flex h-32 w-32 items-center justify-center rounded-md bg-muted/40"
                  >
                    <span className="animate-pulse font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {t('generating')}
                    </span>
                  </div>
                );
              }

              const outputFileId = task.outputFileId;
              const resultAlt = t('resultMeta', { index: String(index + 1) });

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
                      // inpaint 无条件开对比弹窗:底图是按需取回的,若在这里等它,
                      // 首次点击会误入放大预览分支,用户要再点一次才能看到对比。
                      if (group.mode === 'inpaint') {
                        setCompareOpen(true);
                      } else {
                        setLightbox({ fileId: outputFileId, alt: resultAlt });
                      }
                    }}
                    className="block h-full w-full cursor-zoom-in"
                  >
                    <ResultThumb fileId={outputFileId} alt={resultAlt} />
                  </button>

                  {/* 编辑与下载:小图上用图标位,常显以便触摸设备可达。 */}
                  {onEditImage && (
                    <button
                      type="button"
                      aria-label={t('editImage')}
                      title={t('editImage')}
                      onClick={() => onEditImage(outputFileId)}
                      className="absolute left-1 top-1 rounded-md bg-background/90 p-1 text-foreground shadow-sm hover:bg-background"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={t('downloadImage')}
                    title={t('downloadImage')}
                    onClick={() => downloadStoredFile(outputFileId)}
                    className="absolute bottom-1 right-1 rounded-md bg-background/90 px-1.5 py-0.5 text-[10px] text-foreground shadow-sm hover:bg-background"
                  >
                    {t('downloadImage')}
                  </button>
                </figure>
              );
            })}
          </div>
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
        fileId={lightbox?.fileId ?? null}
        alt={lightbox?.alt ?? ''}
        onClose={() => setLightbox(null)}
      />
    </article>
  );
}
