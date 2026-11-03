'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { Download, RotateCcw, Sparkles } from 'lucide-react';
import { ToolPageShell } from '@/components/tools/tool-page-shell';
import { FailureRecoveryPanel } from '@/components/tools/failure-recovery-panel';
import { ResultPanel } from '@/components/tools/result-panel';
import { ImageViewerModal } from '@/components/tools/image-viewer-modal';
import { ProcessingProgress } from '@/components/tools/processing-progress';
import type { ToolStage } from '@/components/tools/tool-step-rail';
import {
  buildImageTryOnTaskPayload,
  MAX_TRY_ON_REFERENCES,
  ReferenceLibraryGrid,
  TRY_ON_PROMPT_MAX_LENGTH,
  type TryOnPersonSource,
  UploadReferenceCard,
} from '@/components/tools/ai-try-on';
import { GarmentLibraryGrid } from '@/components/tools/ai-try-on/GarmentLibraryGrid';
import { getToolByHref } from '@/lib/tools/tool-metadata';
import { getImageUploadMaxFileSize } from '@/lib/tools/image-limits';
import {
  buildFileDownloadUrl,
  downloadStoredFile,
} from '@/lib/files/file-download';
import { useRequireLogin } from '@/hooks/use-require-login';
import { useUploadFile } from '@/hooks/api/use-files';
import {
  useCreateTask,
  useImageGenerateModels,
  useImageGenerateQuota,
  useRetryTask,
} from '@/hooks/api/use-tasks';
import { useAiTryOnReferences } from '@/hooks/api/use-ai-try-on';
import { useTaskProgress } from '@/hooks/api/use-task-progress';
import { taskQueryKeys } from '@/hooks/api/query-keys';
import type { AiTryOnMode } from '@/hooks/api/types';

const TOOL_HREF = '/image/try-on';

const SUBMIT_ERROR_KEYS: Record<string, string> = {
  AI_IMAGE_DAILY_LIMIT_EXCEEDED: 'quotaExceeded',
  AI_IMAGE_CONTENT_REJECTED: 'contentRejected',
  AI_IMAGE_NOT_CONFIGURED: 'notConfigured',
  AI_IMAGE_PROVIDER_UNAVAILABLE: 'providerUnavailable',
};

function extractErrorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

interface ActiveTryOnTaskState {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  outputFileId?: string;
  errorCode?: string;
  errorMessage?: string;
  mode: AiTryOnMode;
}

export default function ImageTryOnPage() {
  const t = useTranslations('ImageTryOn');
  const tShell = useTranslations('ToolShell');
  const queryClient = useQueryClient();
  const tool = getToolByHref('/image/try-on')!;
  const { session, requireLogin } = useRequireLogin();
  const maxFileSize = getImageUploadMaxFileSize(session);

  const uploadFile = useUploadFile();
  const createTask = useCreateTask();
  const retryTask = useRetryTask();
  const quotaQuery = useImageGenerateQuota();
  const modelsQuery = useImageGenerateModels();

  const personLibraryQuery = useAiTryOnReferences('person');
  const garmentLibraryQuery = useAiTryOnReferences('garment');
  const poseLibraryQuery = useAiTryOnReferences('pose');

  const [mode, setMode] = useState<AiTryOnMode>('product');
  const [personSource, setPersonSource] = useState<TryOnPersonSource>('upload');
  const [personFile, setPersonFile] = useState<File | null>(null);
  const [personAssetId, setPersonAssetId] = useState<string | null>(null);
  const [garmentFile, setGarmentFile] = useState<File | null>(null);
  const [garmentAssetId, setGarmentAssetId] = useState<string | null>(null);
  const [poseAssetId, setPoseAssetId] = useState<string | null>(null);
  const [styleAssetId, setStyleAssetId] = useState<string | null>(null);
  const [promptAddition, setPromptAddition] = useState('');
  const [size, setSize] = useState('1024x1024');
  const [quality, setQuality] = useState<'auto' | 'standard' | 'high'>('high');
  const [model, setModel] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [activeTask, setActiveTask] = useState<ActiveTryOnTaskState | null>(
    null
  );

  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerSrc, setViewerSrc] = useState('');

  const uploadedFileCacheRef = useRef<WeakMap<File, string>>(new WeakMap());
  const failedQuotaInvalidatedRef = useRef<Set<string>>(new Set());

  const taskProgressQuery = useTaskProgress(activeTask?.id ?? null);

  const effectiveTask = useMemo<ActiveTryOnTaskState | null>(() => {
    if (!activeTask) return null;
    const polled = taskProgressQuery.data;
    if (!polled) return activeTask;
    return {
      ...activeTask,
      status: polled.status,
      progress: polled.progress ?? activeTask.progress,
      outputFileId: polled.outputFileId ?? activeTask.outputFileId,
      errorCode: polled.errorCode ?? activeTask.errorCode,
      errorMessage: polled.errorMessage ?? activeTask.errorMessage,
    };
  }, [activeTask, taskProgressQuery.data]);

  // 任务失败不计入当日生图额度，检测到新失败时立即刷新共享额度快照。
  useEffect(() => {
    if (
      effectiveTask?.status === 'failed' &&
      !failedQuotaInvalidatedRef.current.has(effectiveTask.id)
    ) {
      failedQuotaInvalidatedRef.current.add(effectiveTask.id);
      void queryClient.invalidateQueries({
        queryKey: taskQueryKeys.imageGenerateQuota(),
      });
    }
  }, [effectiveTask, queryClient]);

  const hasPerson =
    personSource === 'upload' ? Boolean(personFile) : Boolean(personAssetId);
  const hasGarment =
    mode === 'product' ? Boolean(garmentFile) : Boolean(garmentAssetId);
  const hasPose = Boolean(poseAssetId);
  const hasStyle = Boolean(styleAssetId);

  const activeReferenceCount =
    Number(hasPerson) + Number(hasGarment) + Number(hasPose) + Number(hasStyle);

  const personLibraryRequiredAndFailed =
    personSource === 'library' && Boolean(personLibraryQuery.isError);
  const garmentLibraryRequiredAndFailed =
    mode === 'inspiration' && Boolean(garmentLibraryQuery.isError);
  const quotaLoadFailed = Boolean(session && quotaQuery.isError);
  const requiredApiFailed =
    personLibraryRequiredAndFailed ||
    garmentLibraryRequiredAndFailed ||
    quotaLoadFailed;

  const quotaExhausted = Boolean(
    quotaQuery.data && quotaQuery.data.remaining <= 0
  );
  const promptTooLong = promptAddition.trim().length > TRY_ON_PROMPT_MAX_LENGTH;

  const isTaskRunning = Boolean(
    effectiveTask &&
    (effectiveTask.status === 'pending' ||
      effectiveTask.status === 'processing')
  );
  const isBusy = submitting || isTaskRunning;

  const canSubmit =
    !isBusy &&
    hasPerson &&
    hasGarment &&
    !quotaExhausted &&
    !requiredApiFailed &&
    !promptTooLong;

  const stage: ToolStage = useMemo(() => {
    if (effectiveTask?.status === 'completed' && effectiveTask.outputFileId) {
      return 'result';
    }
    if (isBusy) {
      return 'processing';
    }
    if (hasPerson || hasGarment) {
      return 'configure';
    }
    return 'upload';
  }, [effectiveTask, hasGarment, hasPerson, isBusy]);

  const handleFallbackToUpload = () => {
    setMode('product');
    setPersonSource('upload');
    setError(null);
    setErrorCode(undefined);
  };

  const resolveFileId = async (file: File): Promise<string> => {
    const cached = uploadedFileCacheRef.current.get(file);
    if (cached) return cached;
    const uploaded = (await uploadFile.mutateAsync(file)) as unknown as {
      id: string;
    };
    uploadedFileCacheRef.current.set(file, uploaded.id);
    return uploaded.id;
  };

  const handleSubmit = async () => {
    if (requireLogin(TOOL_HREF)) return;
    if (quotaExhausted) {
      setError(t('quotaExhausted'));
      setErrorCode('AI_IMAGE_DAILY_LIMIT_EXCEEDED');
      return;
    }
    if (requiredApiFailed) {
      setError(
        quotaLoadFailed
          ? t('quotaLoadError')
          : t('errors.requiredLibraryFailed')
      );
      return;
    }
    if (!hasPerson) {
      setError(t('errors.missingPerson'));
      return;
    }
    if (!hasGarment) {
      setError(t('errors.missingGarment'));
      return;
    }
    if (
      personSource === 'upload' &&
      mode === 'product' &&
      personFile &&
      garmentFile &&
      personFile === garmentFile
    ) {
      setError(t('errors.duplicateUploadFile'));
      return;
    }

    setError(null);
    setErrorCode(undefined);
    setSubmitting(true);

    try {
      const personInput =
        personSource === 'upload'
          ? {
              source: 'upload' as const,
              fileId: await resolveFileId(personFile!),
            }
          : { source: 'library' as const, assetId: personAssetId ?? '' };

      const garmentInput =
        mode === 'product'
          ? {
              source: 'upload' as const,
              fileId: await resolveFileId(garmentFile!),
            }
          : { source: 'library' as const, assetId: garmentAssetId ?? '' };

      const built = buildImageTryOnTaskPayload({
        mode,
        person: personInput,
        garment: garmentInput,
        poseAssetId,
        styleAssetId,
        promptAddition,
        size,
        quality,
        model: model || undefined,
      });

      if (!built.ok) {
        setError(t(`errors.${built.errorKey}`));
        setSubmitting(false);
        return;
      }

      try {
        const created = await createTask.mutateAsync(built.payload);
        setActiveTask({
          id: created.id,
          status: created.status ?? 'pending',
          progress: created.progress ?? 0,
          outputFileId: created.outputFileId,
          errorCode: created.errorCode,
          errorMessage: created.errorMessage,
          mode,
        });
      } catch (submitErr) {
        const code = extractErrorCode(submitErr);
        const mappedKey = code ? SUBMIT_ERROR_KEYS[code] : undefined;
        setErrorCode(code);
        setError(mappedKey ? t(`errors.${mappedKey}`) : t('errors.failed'));
      }
    } catch {
      setError(t('errors.uploadFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegenerate = () => {
    if (!effectiveTask) return;
    if (effectiveTask.status === 'failed') {
      setError(null);
      setErrorCode(undefined);
      retryTask.mutate(effectiveTask.id, {
        onSuccess: retried => {
          if (retried && typeof retried === 'object' && 'id' in retried) {
            setActiveTask({
              id: retried.id,
              status: retried.status ?? 'pending',
              progress: retried.progress ?? 0,
              outputFileId: retried.outputFileId,
              errorCode: retried.errorCode,
              errorMessage: retried.errorMessage,
              mode: effectiveTask.mode,
            });
          } else {
            setActiveTask(prev =>
              prev
                ? {
                    ...prev,
                    status: 'pending',
                    progress: 0,
                    errorCode: undefined,
                    errorMessage: undefined,
                  }
                : null
            );
          }
        },
      });
      return;
    }
    void handleSubmit();
  };

  const handleReset = () => {
    setPersonFile(null);
    setPersonAssetId(null);
    setGarmentFile(null);
    setGarmentAssetId(null);
    setPoseAssetId(null);
    setStyleAssetId(null);
    setPromptAddition('');
    setActiveTask(null);
    setError(null);
    setErrorCode(undefined);
  };

  const models = modelsQuery.data ?? [];

  const taskFailureMessage = useMemo(() => {
    if (effectiveTask?.status !== 'failed') return null;
    const code = effectiveTask.errorCode;
    const mapped = code ? SUBMIT_ERROR_KEYS[code] : undefined;
    if (mapped) return t(`errors.${mapped}`);
    return effectiveTask.errorMessage || t('errors.failed');
  }, [effectiveTask, t]);

  const progressLabel =
    effectiveTask?.status === 'pending'
      ? t('queued')
      : submitting
        ? t('submitting')
        : t('processing');

  return (
    <ToolPageShell
      title={t('title')}
      description={t('description')}
      processing={tool.processing}
      retention={tool.retention}
      requiresLogin={tool.requiresLogin}
      recovery={tShell('catalogRecovery')}
      stage={stage}
    >
      {/* 顶部模式切换 + 共享额度快照 + 参考图计数 */}
      <div className="space-y-4 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              {t('modeLabel')}
            </span>
            <div
              role="group"
              aria-label={t('modeLabel')}
              className="flex rounded-md border border-border overflow-hidden"
            >
              <button
                type="button"
                aria-pressed={mode === 'product'}
                data-testid="mode-product"
                disabled={isBusy}
                onClick={() => {
                  setMode('product');
                  setError(null);
                }}
                className={`px-4 py-2 font-mono text-xs transition-colors ${
                  mode === 'product'
                    ? 'bg-foreground text-background'
                    : 'bg-background text-muted-foreground hover:text-foreground'
                }`}
              >
                {t('modes.product')}
              </button>
              <button
                type="button"
                aria-pressed={mode === 'inspiration'}
                data-testid="mode-inspiration"
                disabled={isBusy}
                onClick={() => {
                  setMode('inspiration');
                  setError(null);
                }}
                className={`px-4 py-2 font-mono text-xs transition-colors ${
                  mode === 'inspiration'
                    ? 'bg-foreground text-background'
                    : 'bg-background text-muted-foreground hover:text-foreground'
                }`}
              >
                {t('modes.inspiration')}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {quotaQuery.data && (
              <span
                data-testid="try-on-quota-badge"
                className="rounded-md border border-border bg-muted/30 px-2.5 py-1 font-mono text-xs text-foreground"
              >
                {t('quotaBadge', {
                  remaining: quotaQuery.data.remaining,
                  limit: quotaQuery.data.limit,
                })}
              </span>
            )}
            <span
              data-testid="try-on-reference-count"
              className="rounded-md border border-border bg-muted/20 px-2.5 py-1 font-mono text-xs text-muted-foreground"
            >
              {t('referenceCount', {
                count: activeReferenceCount,
                max: MAX_TRY_ON_REFERENCES,
              })}
            </span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          {mode === 'product'
            ? t('modes.productDescription')
            : t('modes.inspirationDescription')}
        </p>
        <p className="text-[11px] font-mono text-muted-foreground">
          {t('referenceLimitHint')}
        </p>

        {quotaExhausted && (
          <div
            role="alert"
            data-testid="try-on-quota-exhausted"
            className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {t('quotaExhausted')}
          </div>
        )}

        {quotaLoadFailed && (
          <div
            role="alert"
            data-testid="try-on-quota-error"
            className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {t('quotaLoadError')}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 1. 人像参考（必选） */}
        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-medium">{t('personSectionTitle')}</h2>
              <p className="text-xs text-muted-foreground">
                {t('personSectionHint')}
              </p>
            </div>
            <div className="flex rounded-md border border-border overflow-hidden">
              <button
                type="button"
                aria-pressed={personSource === 'upload'}
                data-testid="person-source-upload"
                disabled={isBusy}
                onClick={() => {
                  setPersonSource('upload');
                  setError(null);
                }}
                className={`px-3 py-1.5 font-mono text-xs transition-colors ${
                  personSource === 'upload'
                    ? 'bg-foreground text-background'
                    : 'bg-background text-muted-foreground hover:text-foreground'
                }`}
              >
                {t('personSourceUpload')}
              </button>
              <button
                type="button"
                aria-pressed={personSource === 'library'}
                data-testid="person-source-library"
                disabled={isBusy}
                onClick={() => {
                  setPersonSource('library');
                  setError(null);
                }}
                className={`px-3 py-1.5 font-mono text-xs transition-colors ${
                  personSource === 'library'
                    ? 'bg-foreground text-background'
                    : 'bg-background text-muted-foreground hover:text-foreground'
                }`}
              >
                {t('personSourceLibrary')}
              </button>
            </div>
          </div>

          {personSource === 'upload' ? (
            <UploadReferenceCard
              role="person"
              file={personFile}
              actionLabel={t('personUploadAction')}
              maxFileSize={maxFileSize}
              disabled={isBusy}
              onFileChange={file => {
                setPersonFile(file);
                setError(null);
              }}
              onOversizeError={maxSizeFormatted =>
                setError(t('errors.fileTooLarge', { size: maxSizeFormatted }))
              }
            />
          ) : (
            <ReferenceLibraryGrid
              role="person"
              items={personLibraryQuery.data ?? []}
              selectedId={personAssetId}
              onSelect={id => {
                setPersonAssetId(id);
                setError(null);
              }}
              isLoading={personLibraryQuery.isLoading}
              isError={personLibraryQuery.isError}
              onRetry={() => void personLibraryQuery.refetch?.()}
              onFallbackToUpload={handleFallbackToUpload}
              disabled={isBusy}
            />
          )}
        </section>

        {/* 2. 目标服装参考（必选） */}
        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div>
            <h2 className="text-sm font-medium">
              {mode === 'product'
                ? t('garmentProductSectionTitle')
                : t('garmentInspirationSectionTitle')}
            </h2>
            <p className="text-xs text-muted-foreground">
              {mode === 'product'
                ? t('garmentProductSectionHint')
                : t('garmentInspirationSectionHint')}
            </p>
          </div>

          {mode === 'product' ? (
            <UploadReferenceCard
              role="garment"
              file={garmentFile}
              actionLabel={t('garmentUploadAction')}
              maxFileSize={maxFileSize}
              disabled={isBusy}
              onFileChange={file => {
                setGarmentFile(file);
                setError(null);
              }}
              onOversizeError={maxSizeFormatted =>
                setError(t('errors.fileTooLarge', { size: maxSizeFormatted }))
              }
            />
          ) : (
            <GarmentLibraryGrid
              role="garment"
              items={garmentLibraryQuery.data ?? []}
              selectedId={garmentAssetId}
              onSelect={id => {
                setGarmentAssetId(id);
                setError(null);
              }}
              isLoading={garmentLibraryQuery.isLoading}
              isError={garmentLibraryQuery.isError}
              onRetry={() => void garmentLibraryQuery.refetch?.()}
              onFallbackToUpload={handleFallbackToUpload}
              disabled={isBusy}
            />
          )}
        </section>

        {/* 3. 姿势参考（可选） */}
        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div>
            <h2 className="text-sm font-medium">{t('poseSectionTitle')}</h2>
            <p className="text-xs text-muted-foreground">
              {t('poseSectionHint')}
            </p>
          </div>

          <ReferenceLibraryGrid
            role="pose"
            items={poseLibraryQuery.data ?? []}
            selectedId={poseAssetId}
            onSelect={id => {
              setPoseAssetId(id);
              setError(null);
            }}
            isLoading={poseLibraryQuery.isLoading}
            isError={poseLibraryQuery.isError}
            onRetry={() => void poseLibraryQuery.refetch?.()}
            disabled={isBusy}
            optional
          />
        </section>

        {/* 4. 辅助穿搭风格（可选 · 弱优先级） */}
        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div>
            <h2 className="text-sm font-medium">{t('styleSectionTitle')}</h2>
            <p className="text-xs text-muted-foreground">
              {t('styleSectionHint')}
            </p>
          </div>

          <ReferenceLibraryGrid
            role="style"
            items={garmentLibraryQuery.data ?? []}
            selectedId={styleAssetId}
            onSelect={id => {
              setStyleAssetId(id);
              setError(null);
            }}
            isLoading={garmentLibraryQuery.isLoading}
            isError={garmentLibraryQuery.isError}
            onRetry={() => void garmentLibraryQuery.refetch?.()}
            disabled={isBusy}
            optional
          />
        </section>
      </div>

      {/* 5. 场景补充说明与生成参数（可选） */}
      <section className="space-y-4 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium">{t('promptSectionTitle')}</h2>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label
              htmlFor="try-on-prompt-addition"
              className="text-xs text-muted-foreground"
            >
              {t('promptLabel')}
            </label>
            <span
              className={`font-mono text-[11px] tabular-nums ${
                promptTooLong ? 'text-destructive' : 'text-muted-foreground'
              }`}
            >
              {t('promptCounter', {
                count: promptAddition.trim().length,
                max: TRY_ON_PROMPT_MAX_LENGTH,
              })}
            </span>
          </div>
          <textarea
            id="try-on-prompt-addition"
            rows={2}
            value={promptAddition}
            disabled={isBusy}
            placeholder={t('promptPlaceholder')}
            onChange={event => {
              setPromptAddition(event.target.value);
              setError(null);
            }}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none disabled:opacity-50"
          />
          {promptTooLong && (
            <p role="alert" className="text-xs text-destructive">
              {t('errors.promptTooLong')}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <label
              htmlFor="try-on-size"
              className="text-xs text-muted-foreground"
            >
              {t('sizeLabel')}
            </label>
            <select
              id="try-on-size"
              value={size}
              disabled={isBusy}
              onChange={event => setSize(event.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground"
            >
              <option value="auto">{t('sizes.auto')}</option>
              <option value="1024x1024">{t('sizes.square')}</option>
              <option value="1024x1536">{t('sizes.portrait')}</option>
              <option value="1536x1024">{t('sizes.landscape')}</option>
            </select>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="try-on-quality"
              className="text-xs text-muted-foreground"
            >
              {t('qualityLabel')}
            </label>
            <select
              id="try-on-quality"
              value={quality}
              disabled={isBusy}
              onChange={event =>
                setQuality(event.target.value as 'auto' | 'standard' | 'high')
              }
              className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground"
            >
              <option value="high">{t('qualities.high')}</option>
              <option value="standard">{t('qualities.standard')}</option>
              <option value="auto">{t('qualities.auto')}</option>
            </select>
          </div>

          {models.length > 1 && (
            <div className="space-y-1">
              <label
                htmlFor="try-on-model"
                className="text-xs text-muted-foreground"
              >
                {t('modelLabel')}
              </label>
              <select
                id="try-on-model"
                value={model || models[0]?.model || ''}
                disabled={isBusy}
                onChange={event => setModel(event.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground"
              >
                {models.map(item => (
                  <option key={item.model} value={item.model}>
                    {item.model}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {requiredApiFailed && !quotaLoadFailed && (
          <div
            role="alert"
            data-testid="try-on-required-library-error"
            className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {t('errors.requiredLibraryFailed')}
          </div>
        )}

        <button
          type="button"
          data-testid="try-on-submit"
          disabled={!canSubmit}
          onClick={() => void handleSubmit()}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-foreground font-mono text-sm text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" />
          {isBusy ? progressLabel : t('submit')}
        </button>
      </section>

      {/* 排队 / 处理中状态 */}
      {isBusy && (
        <ProcessingProgress
          progress={
            effectiveTask?.status === 'processing'
              ? Math.max(10, effectiveTask.progress)
              : 5
          }
          label={progressLabel}
        />
      )}

      {/* 失败恢复面板（表单级报错或任务执行失败） */}
      {(error || taskFailureMessage) && (
        <FailureRecoveryPanel
          message={error ?? taskFailureMessage ?? t('errors.failed')}
          errorCode={errorCode ?? effectiveTask?.errorCode}
          onRetry={
            effectiveTask?.status === 'failed'
              ? handleRegenerate
              : () => void handleSubmit()
          }
          onReset={handleReset}
        />
      )}

      {/* 成功结果面板：标明 AI 生成及试衣模式 */}
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
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={buildFileDownloadUrl(effectiveTask.outputFileId)}
                alt={t('resultPreviewAlt')}
                className="mx-auto max-h-96 w-auto rounded-md border border-border object-contain cursor-pointer hover:opacity-90"
                onClick={() => {
                  setViewerSrc(buildFileDownloadUrl(effectiveTask.outputFileId!));
                  setViewerOpen(true);
                }}
              />
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
    </ToolPageShell>
  );
}
