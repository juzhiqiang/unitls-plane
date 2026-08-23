'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { useCreateTask } from '@/hooks/api/use-tasks';
import { useUploadFile } from '@/hooks/api/use-files';
import { useTaskGroupProgress } from '@/hooks/api/use-task-group-progress';
import {
  ImageGenerateOptions,
  type ImageGenerateDraft,
} from '@/components/tools/image-generate-options';
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

const ERROR_MESSAGE_KEY: Record<string, string> = {
  AI_IMAGE_DAILY_LIMIT_EXCEEDED: 'quotaExceeded',
  AI_IMAGE_CONTENT_REJECTED: 'contentRejected',
  AI_IMAGE_NOT_CONFIGURED: 'notConfigured',
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
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const createTask = useCreateTask();
  const uploadFile = useUploadFile();

  const [draft, setDraft] = useState<ImageGenerateDraft>(INITIAL_DRAFT);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});

  const sourceUrl = useObjectUrl(sourceFile);
  const maxFileSize = getImageUploadMaxFileSize(session);

  // 切回文生图时丢掉参考图:留着它会让「模式=文生图 却带着 inputFileIds」这种
  // schema 会直接拒的组合有机会被提交。
  const changeDraft = (next: ImageGenerateDraft) => {
    if (next.mode !== 'image_to_image') setSourceFile(null);
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
    if (!session) {
      router.push(`/login?next=${encodeURIComponent(TOOL_HREF)}`);
      return;
    }
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
        const uploaded = (await uploadFile.mutateAsync(sourceFile)) as {
          id: string;
        };
        inputFileIds = [uploaded.id];
      } catch {
        setFailure({ key: 'uploadFailed' });
        setSubmitting(false);
        return;
      }
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
      recovery={t('failed')}
      stage={stage}
    >
      <div className="rounded-md border border-border p-4">
        <ImageGenerateOptions
          value={draft}
          onChange={changeDraft}
          disabled={submitting || inFlight}
        />
      </div>

      {needsReference && (
        <div className="space-y-3 rounded-md border border-border p-4">
          <p className="text-sm font-medium">{t('sourceLabel')}</p>
          <FileDropzone
            accept={REFERENCE_ACCEPT}
            maxSize={maxFileSize}
            density="compact"
            disabled={submitting || inFlight}
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

      <button
        type="button"
        className="rounded-md border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
        disabled={
          draft.prompt.trim().length === 0 ||
          referenceMissing ||
          submitting ||
          inFlight
        }
        onClick={submit}
      >
        {submitting || inFlight ? t('generating') : t('submit')}
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
        return (
          <ResultPanel
            key={item.taskId}
            title={t('resultTitle')}
            description={t('resultMeta', { index: index + 1 })}
            preview={
              previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt={t('resultMeta', { index: index + 1 })}
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
    </ToolPageShell>
  );
}
