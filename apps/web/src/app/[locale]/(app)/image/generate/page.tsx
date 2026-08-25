'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  useCreateTask,
  useImageGenerateProviders,
  useImageGenerateQuota,
} from '@/hooks/api/use-tasks';
import { useUploadFile } from '@/hooks/api/use-files';
import { useTaskGroupProgress } from '@/hooks/api/use-task-group-progress';
import { useRequireLogin } from '@/hooks/use-require-login';
import {
  ImageGenerateModeField,
  ImageGenerateParamsFields,
  ImageGeneratePromptField,
  ImageGenerateProviderField,
  type ImageGenerateDraft,
} from '@/components/tools/image-generate-options';
import { ImageGenerateCompare } from '@/components/tools/image-generate-compare';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { ProcessingProgress } from '@/components/tools/processing-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { FailureRecoveryPanel } from '@/components/tools/failure-recovery-panel';
import { ToolPageShell } from '@/components/tools/tool-page-shell';
import type { ToolStage } from '@/components/tools/tool-step-rail';
import { useObjectUrl } from '@/hooks/use-object-url';
import { getImageUploadMaxFileSize } from '@/lib/tools/image-limits';

const TOOL_HREF = '/image/generate';

const REFERENCE_ACCEPT = {
  'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.avif'],
};

/** 文生图没有上传环节,步骤条不该给它挂一个永远不会发生的第一步。 */
const TEXT_TO_IMAGE_STAGES: readonly ToolStage[] = [
  'configure',
  'processing',
  'result',
];
const IMAGE_TO_IMAGE_STAGES: readonly ToolStage[] = [
  'upload',
  'configure',
  'processing',
  'result',
];

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
  const uploadFile = useUploadFile();

  const [draft, setDraft] = useState<ImageGenerateDraft>(INITIAL_DRAFT);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  // 提交那一刻用到的参考图,单独存一份:用户在看结果时换图不该悄悄改掉对比的「前」。
  const [comparedFile, setComparedFile] = useState<File | null>(null);
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});

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

  const loadPreview = useCallback(async (taskId: string, fileId: string) => {
    if (!fileId) return;
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/files/${fileId}/download`,
        { credentials: 'include' }
      );
      if (!response.ok) return;
      const url = URL.createObjectURL(await response.blob());
      setPreviews(current => ({ ...current, [taskId]: url }));
    } catch {
      // fetch 本身抛出的网络错误在此静默忽略,否则会在完成回调里变成 unhandled rejection。
    }
  }, []);

  const { items, settled, query } = useTaskGroupProgress(taskIds, {
    onItemCompleted: loadPreview,
  });

  // useTaskGroupProgress 的 queryFn 用 Promise.all 并发取 N 个状态,任一任务永久失败
  // (例如 taskId 返回 404)会让整个 query 进 error、settled 永不为 true、其余回调永不
  // 触发。必须消费 query.isError,否则永久失败会表现为「进度条转到底也不结束」。
  const groupErrored =
    taskIds.length > 0 && !settled && Boolean(query?.isError);
  const inFlight = taskIds.length > 0 && !settled && !groupErrored;

  // previewsRef 跟随最新 previews,供 reset 与卸载清理读取当前值。
  const previewsRef = useRef<Record<string, string>>({});
  useEffect(() => {
    previewsRef.current = previews;
  }, [previews]);

  // 只在卸载时统一回收 blob URL。不能把 cleanup 挂在 [previews] 上:每有一张图完成、
  // previews 更新时,React 会先跑上一轮 cleanup(闭包捕获的是旧 previews),把仍在展示
  // 的前一张 URL 提前 revoke 掉,导致其下载链接指向失效 blob。
  useEffect(
    () => () => {
      for (const url of Object.values(previewsRef.current)) {
        URL.revokeObjectURL(url);
      }
    },
    []
  );

  const reset = () => {
    // 重新提交时显式回收上一批 URL,避免累积泄漏。
    for (const url of Object.values(previewsRef.current)) {
      URL.revokeObjectURL(url);
    }
    setTaskIds([]);
    setFailure(null);
    setPreviews({});
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
  const busy = submitting || inFlight;

  const stage: ToolStage = submitting
    ? 'processing'
    : taskIds.length === 0
      ? referenceMissing
        ? 'upload'
        : 'configure'
      : settled || groupErrored
        ? 'result'
        : 'processing';

  const averageProgress =
    items.length > 0
      ? items.reduce((sum, item) => sum + (item.progress ?? 0), 0) /
        items.length
      : 0;

  return (
    <ToolPageShell
      title={t('title')}
      description={t('description')}
      processing="server"
      retention="account-files"
      requiresLogin
      recovery={t('recoveryHint')}
      stage={stage}
      stages={needsReference ? IMAGE_TO_IMAGE_STAGES : TEXT_TO_IMAGE_STAGES}
    >
      {/* 主输入块:模式 →(图生图)参考图 → 提示词。顺序与步骤条一致。 */}
      <div className="space-y-5 rounded-md border border-border p-4">
        <ImageGenerateProviderField
          value={draft}
          onChange={changeDraft}
          disabled={busy}
          providers={providers}
        />

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
                className="max-h-64 w-auto rounded-md border border-border"
              />
            )}
          </div>
        )}

        <ImageGeneratePromptField
          value={draft}
          onChange={changeDraft}
          disabled={busy}
        />
      </div>

      <ImageGenerateParamsFields
        value={draft}
        onChange={changeDraft}
        disabled={busy}
      />

      {/* 已登录才展示当日额度:free = 0,匿名走登录跳转,没必要显示一行 0。 */}
      {session && quota.data && (
        <p className="font-mono text-xs tabular-nums text-muted-foreground">
          {t('quotaRemaining', {
            remaining: String(quota.data.remaining),
            limit: String(quota.data.limit),
          })}
        </p>
      )}

      {/* 主操作与其它图片工具页保持一致:整宽填充按钮。 */}
      <button
        type="button"
        className="h-10 w-full rounded-md bg-foreground font-mono text-sm text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={draft.prompt.trim().length === 0 || referenceMissing || busy}
        onClick={submit}
      >
        {busy ? t('generating') : t('submit')}
      </button>

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

      {inFlight && (
        <ProcessingProgress progress={averageProgress} stage="generating" />
      )}

      {/* 多张结果排成两列:整宽堆叠时 4 张要滚很久,也没法互相比较。 */}
      <div
        className={items.length > 1 ? 'grid gap-6 sm:grid-cols-2' : 'space-y-6'}
      >
        {items.map((item, index) => {
          if (item.status === 'failed') {
            return (
              <FailureRecoveryPanel
                key={item.taskId}
                message={t(ERROR_MESSAGE_KEY[item.errorCode ?? ''] ?? 'failed')}
                errorCode={item.errorCode}
                onRetry={submit}
              />
            );
          }
          if (item.status !== 'completed') return null;

          const previewUrl = previews[item.taskId];
          const alt = t('resultMeta', { index: index + 1 });
          // 图生图给滑动对比:参考图和结果分处页面两端时,看不出到底改了什么。
          const showCompare = Boolean(comparedUrl && previewUrl);

          return (
            <ResultPanel
              key={item.taskId}
              title={t('resultTitle')}
              description={alt}
              preview={
                showCompare && comparedUrl && previewUrl ? (
                  <ImageGenerateCompare
                    beforeUrl={comparedUrl}
                    afterUrl={previewUrl}
                    title={t('compareTitle')}
                  />
                ) : previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt={alt}
                    className="max-h-96 w-auto rounded-md"
                  />
                ) : undefined
              }
              action={
                previewUrl ? (
                  <a
                    href={previewUrl}
                    download={`ai-image-${index + 1}.png`}
                    className="rounded-md border px-3 py-1.5 text-sm"
                  >
                    {tShared('download')}
                  </a>
                ) : null
              }
            />
          );
        })}
      </div>
    </ToolPageShell>
  );
}
