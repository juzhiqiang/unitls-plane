'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  useCreateTask,
  useImageGeneratePresets,
  useImageGenerateProviders,
  useImageGenerateQuota,
} from '@/hooks/api/use-tasks';
import { useUploadFile } from '@/hooks/api/use-files';
import { useTaskGroupProgress } from '@/hooks/api/use-task-group-progress';
import { useTaskOutputPreviews } from '@/hooks/api/use-task-output';
import { useRequireLogin } from '@/hooks/use-require-login';
import {
  ImageGenerateModeField,
  ImageGenerateParamsFields,
  ImageGeneratePromptField,
  ImageGenerateProviderField,
  type ImageGenerateDraft,
} from '@/components/tools/image-generate-options';
import { ImageGenerateCompare } from '@/components/tools/image-generate-compare';
import { ImageGenerateTemplateWall } from '@/components/tools/image-generate-template-wall';
import { ImageGenerateWorkbench } from '@/components/tools/image-generate-workbench';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { ProcessingProgress } from '@/components/tools/processing-progress';
import { FailureRecoveryPanel } from '@/components/tools/failure-recovery-panel';
import { useObjectUrl } from '@/hooks/use-object-url';
import { getImageUploadMaxFileSize } from '@/lib/tools/image-limits';

const TOOL_HREF = '/image/generate';

const REFERENCE_ACCEPT = {
  'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.avif'],
};

const ERROR_MESSAGE_KEY: Record<string, string> = {
  AI_IMAGE_DAILY_LIMIT_EXCEEDED: 'quotaExceeded',
  AI_IMAGE_CONTENT_REJECTED: 'contentRejected',
  AI_IMAGE_NOT_CONFIGURED: 'notConfigured',
  AI_IMAGE_PROVIDER_UNAVAILABLE: 'providerUnavailable',
};

const INITIAL_DRAFT: ImageGenerateDraft = {
  mode: 'text_to_image',
  prompt: '',
  size: '1024x1024',
  quality: 'high',
  count: 1,
};

/** 失败提示统一走一个通道:key 是文案,code 只有服务端错误才有。 */
interface Failure {
  key: string;
  code?: string;
}

function errorCodeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'AI_IMAGE_GENERATION_FAILED';
}

export default function ImageGeneratePage() {
  const t = useTranslations('ImageGenerate');
  const tShared = useTranslations('ToolsShared');
  const { session, requireLogin } = useRequireLogin();
  const createTask = useCreateTask();
  const quota = useImageGenerateQuota();
  const providersQuery = useImageGenerateProviders();
  const presetsQuery = useImageGeneratePresets();
  const uploadFile = useUploadFile();

  const [draft, setDraft] = useState<ImageGenerateDraft>(INITIAL_DRAFT);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  // 提交那一刻用到的参考图,单独存一份:用户在看结果时换图不该悄悄改掉对比的「前」。
  const [comparedFile, setComparedFile] = useState<File | null>(null);
  const [taskIds, setTaskIds] = useState<string[]>([]);
  // 结果态下大图展示第几张;新一轮生成时在 reset 里归零。
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  // 产物取回(状态 completed 之后还要再下载一次 blob)收在 hook 里,页面只读 previews/pending。
  const output = useTaskOutputPreviews();

  // 来源列表拉取失败或还没回来时按「单来源」渲染:选择器不出现,providerId 不下发,
  // 服务端仍会用配置里的第一个来源,页面不会因为这个附加接口而不可用。
  const providers = providersQuery.data ?? [];
  const selectedProvider =
    providers.find(item => item.id === draft.providerId) ?? providers[0];
  // 没拿到来源信息时不预先禁掉图生图:真正的能力校验在服务端。
  const editSupported =
    !selectedProvider || selectedProvider.capabilities.includes('edit');

  const sourceUrl = useObjectUrl(sourceFile);
  const comparedUrl = useObjectUrl(comparedFile);
  const maxFileSize = getImageUploadMaxFileSize(session);

  // 切回文生图时丢掉参考图:留着它会让「模式=文生图 却带着 inputFileIds」这种
  // schema 会直接拒的组合有机会被提交。
  const changeDraft = (next: ImageGenerateDraft) => {
    if (next.mode !== 'image_to_image') {
      setSourceFile(null);
      setComparedFile(null);
    }
    setDraft(next);
  };

  const { items, settled, query } = useTaskGroupProgress(taskIds, {
    onItemCompleted: output.load,
  });

  // useTaskGroupProgress 的 queryFn 用 Promise.all 并发取 N 个状态,任一任务永久失败
  // (例如 taskId 返回 404)会让整个 query 进 error、settled 永不为 true、其余回调永不
  // 触发。必须消费 query.isError,否则永久失败会表现为「进度条转到底也不结束」。
  const groupErrored =
    taskIds.length > 0 && !settled && Boolean(query?.isError);
  const inFlight = taskIds.length > 0 && !settled && !groupErrored;

  const reset = () => {
    setTaskIds([]);
    setFailure(null);
    setSelectedIndex(0);
    output.reset();
  };

  const submit = async () => {
    if (requireLogin(TOOL_HREF)) return;
    const needsReference = draft.mode === 'image_to_image';
    if (needsReference && !sourceFile) {
      setFailure({ key: 'sourceRequired' });
      return;
    }

    reset();
    setSubmitting(true);

    // 参考图只上传一次,N 个任务共用同一个 fileId:同一张图重复上传既费额度也费带宽。
    let inputFileIds: string[] = [];
    if (needsReference && sourceFile) {
      try {
        // upload 走 multipart,OpenAPI 里 201 没有 JSON content schema,openapi-fetch
        // 把返回类型推成 undefined,这里先转 unknown 再断言,与 use-files 里
        // `data as unknown as FileListResponse` 同一处理方式。
        const uploaded = (await uploadFile.mutateAsync(
          sourceFile
        )) as unknown as {
          id: string;
        };
        inputFileIds = [uploaded.id];
        setComparedFile(sourceFile);
      } catch {
        setFailure({ key: 'uploadFailed' });
        setSubmitting(false);
        return;
      }
    } else {
      setComparedFile(null);
    }

    const created: string[] = [];
    let failureCode: string | null = null;

    // 串行(而非 Promise.all)创建:createTask 只是入队(廉价 insert),真正生成在
    // worker 并发跑,N 张只多几次入队往返。串行才能让配额判定确定——每次都看到前一次扣减
    // 后的计数,第一个 AI_IMAGE_DAILY_LIMIT_EXCEEDED 能干净地 break。Promise.all 无法
    // break 且会与配额记账竞态,切勿"优化"成并发。
    for (let index = 0; index < draft.count; index += 1) {
      try {
        const task = await createTask.mutateAsync({
          type: 'image_generate',
          inputFileIds,
          inputConfig: {
            mode: draft.mode,
            prompt: draft.prompt.trim(),
            size: draft.size,
            quality: draft.quality,
            ...(draft.style ? { style: draft.style } : {}),
            ...(draft.providerId ? { providerId: draft.providerId } : {}),
          },
        });
        created.push(task.id);
      } catch (error) {
        // 部分超额不整批回滚:已建出的任务继续跑,剩下的报错。
        failureCode = errorCodeOf(error);
        break;
      }
    }

    setTaskIds(created);
    setFailure(
      failureCode
        ? { key: ERROR_MESSAGE_KEY[failureCode] ?? 'failed', code: failureCode }
        : null
    );
    setSubmitting(false);
  };

  const needsReference = draft.mode === 'image_to_image';
  const referenceMissing = needsReference && !sourceFile;

  // 任务 settled 只说明服务端出图了,页面还要再下载一次 blob 才有东西可看。缺 entry
  // 视为 loading:onItemCompleted 与 items 更新同一轮,少了这个兜底会漏出一帧空窗,
  // 表现就是按钮先恢复、结果区空着、图片随后突然出现。
  const fetchingResults =
    taskIds.length > 0 &&
    items.some(
      item =>
        item.status === 'completed' &&
        (output.previews[item.taskId]?.state ?? 'loading') === 'loading'
    );
  const busy = submitting || inFlight || fetchingResults;

  const averageProgress =
    items.length > 0
      ? items.reduce((sum, item) => sum + (item.progress ?? 0), 0) /
        items.length
      : 0;

  // 大图位:已完成的任务里按 selectedIndex 取,越界时夹回最后一张。
  const completedItems = items.filter(item => item.status === 'completed');
  const activeIndex = Math.min(
    selectedIndex,
    Math.max(completedItems.length - 1, 0)
  );
  const activeItem = completedItems[activeIndex];
  const activeUrl = activeItem
    ? output.previews[activeItem.taskId]?.url
    : undefined;
  // 图生图给滑动对比:参考图和结果分处页面两端时,看不出到底改了什么。
  const showCompare = Boolean(comparedUrl && activeUrl);

  // 右主区空态:还没提交过、也没有失败提示,才把版面交给模板墙。items 非空说明
  // 已有结果可看(测试与 mock 场景会在 taskIds 之外直接喂数据),绝不能回到空态。
  const showWall =
    !submitting && taskIds.length === 0 && items.length === 0 && !failure;

  const pickPreset = (prompt: string) => {
    changeDraft({ ...draft, prompt });
    // 填完把焦点交回输入框,用户可以立刻继续改写模板。
    document.getElementById('image-generate-prompt')?.focus();
  };

  return (
    <ImageGenerateWorkbench
      title={t('title')}
      panel={
        <>
          {/* 左面板顺序:模式 →(图生图)参考图 → 提示词 → 参数组 → 来源(多来源时)。 */}
          <ImageGenerateModeField
            value={draft}
            onChange={changeDraft}
            disabled={busy}
            editSupported={editSupported}
          />

          {needsReference && (
            <div className="space-y-3">
              <p className="text-sm font-medium">{t('sourceLabel')}</p>
              <FileDropzone
                accept={REFERENCE_ACCEPT}
                maxSize={maxFileSize}
                density="compact"
                disabled={busy}
                hint={t('sourceHint')}
                onDrop={files => {
                  const [next] = files;
                  if (next) setSourceFile(next);
                }}
              />
              {sourceUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={sourceUrl}
                  alt={t('sourcePreviewAlt')}
                  className="max-h-48 w-auto rounded-md border border-border"
                />
              )}
            </div>
          )}

          <ImageGeneratePromptField
            value={draft}
            onChange={changeDraft}
            disabled={busy}
            presets={presetsQuery.data ?? []}
          />

          <ImageGenerateParamsFields
            value={draft}
            onChange={changeDraft}
            disabled={busy}
          />

          <ImageGenerateProviderField
            value={draft}
            onChange={changeDraft}
            disabled={busy}
            providers={providers}
          />
        </>
      }
      panelFooter={
        <>
          {/* 已登录才展示当日额度:free = 0,匿名走登录跳转,没必要显示一行 0。 */}
          {session && quota.data && (
            <p className="font-mono text-xs tabular-nums text-muted-foreground">
              {t('quotaRemaining', {
                remaining: String(quota.data.remaining),
                limit: String(quota.data.limit),
              })}
            </p>
          )}

          {/* 主操作吸面板底部:参数区怎么滚,按钮始终在手边。 */}
          <button
            type="button"
            className="h-10 w-full rounded-md bg-foreground font-mono text-sm text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={
              draft.prompt.trim().length === 0 || referenceMissing || busy
            }
            onClick={submit}
          >
            {busy ? t('generating') : t('submit')}
          </button>
        </>
      }
    >
      {showWall ? (
        <ImageGenerateTemplateWall
          presets={presetsQuery.data ?? []}
          disabled={busy}
          onPick={pickPreset}
        />
      ) : (
        <div className="space-y-5">
          {/* 工作态全程给进度占位:上传参考图 + 串行建任务的 submitting 阶段、
              生成中的 inFlight、取回图片的空窗,都不能让主区先空着。 */}
          {(submitting || inFlight || fetchingResults) && (
            <ProcessingProgress
              progress={averageProgress}
              stage={inFlight ? 'generating' : undefined}
              label={
                !inFlight && fetchingResults ? t('resultFetching') : undefined
              }
            />
          )}

          {failure && (
            <FailureRecoveryPanel
              message={t(failure.key)}
              errorCode={failure.code}
              onRetry={submit}
            />
          )}

          {groupErrored && (
            <FailureRecoveryPanel message={t('failed')} onRetry={submit} />
          )}

          {activeItem && (
            <section className="space-y-3">
              <div className="flex min-h-64 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/20 p-2">
                {!activeUrl ? (
                  <div
                    role="status"
                    aria-live="polite"
                    className="flex h-64 w-full items-center justify-center"
                  >
                    <span className="animate-pulse font-mono text-xs uppercase tracking-wider text-muted-foreground">
                      {t('resultFetching')}
                    </span>
                  </div>
                ) : showCompare ? (
                  <div className="w-full">
                    <ImageGenerateCompare
                      beforeUrl={comparedUrl!}
                      afterUrl={activeUrl}
                      title={t('compareTitle')}
                    />
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={activeUrl}
                    alt={t('resultMeta', { index: activeIndex + 1 })}
                    className="max-h-[32rem] w-auto rounded-md"
                  />
                )}
              </div>

              {activeUrl && (
                <a
                  href={activeUrl}
                  download={`ai-image-${activeIndex + 1}.png`}
                  className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm hover:bg-muted/40"
                >
                  {tShared('download')}
                </a>
              )}

              {/* 多张结果才有缩略条:单张大图不需要「切换到自己」。 */}
              {completedItems.length > 1 && (
                <div
                  role="group"
                  aria-label={t('thumbnailLabel')}
                  className="flex flex-wrap gap-2"
                >
                  {completedItems.map((item, index) => {
                    const thumbUrl = output.previews[item.taskId]?.url;
                    return (
                      <button
                        key={item.taskId}
                        type="button"
                        aria-label={t('selectResult', { index: index + 1 })}
                        aria-pressed={index === activeIndex}
                        // blob URL 在 reset() 前一直存活,生成中途也能安全切换到
                        // 已取回的图;没取回的缩略位本来就有脉动占位,只按它禁用。
                        disabled={!thumbUrl}
                        onClick={() => setSelectedIndex(index)}
                        className={`overflow-hidden rounded-md border p-0.5 ${
                          index === activeIndex
                            ? 'border-foreground'
                            : 'border-transparent hover:border-border'
                        }`}
                      >
                        {thumbUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={thumbUrl}
                            alt=""
                            className="h-16 w-16 rounded-sm object-cover"
                          />
                        ) : (
                          <span className="block h-16 w-16 animate-pulse rounded-sm bg-muted" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* 逐项异常:生成失败的任务、取回失败的任务。取回失败给「重试取回」,
              不是重新生成 —— 图已经出好了,再走一遍生成会白扣一次配额。 */}
          {items.map(item => {
            if (item.status === 'failed') {
              return (
                <FailureRecoveryPanel
                  key={item.taskId}
                  message={t(
                    ERROR_MESSAGE_KEY[item.errorCode ?? ''] ?? 'failed'
                  )}
                  errorCode={item.errorCode}
                  onRetry={submit}
                />
              );
            }
            if (
              item.status === 'completed' &&
              output.previews[item.taskId]?.state === 'error'
            ) {
              return (
                <FailureRecoveryPanel
                  key={item.taskId}
                  message={t('resultFetchFailed')}
                  onRetry={() =>
                    void output.load(item.taskId, item.outputFileId ?? '')
                  }
                />
              );
            }
            return null;
          })}
        </div>
      )}
    </ImageGenerateWorkbench>
  );
}
