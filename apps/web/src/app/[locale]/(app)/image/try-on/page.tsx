'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Download, RotateCcw, Sparkles, X } from 'lucide-react';
import { ToolPageShell } from '@/components/tools/tool-page-shell';
import { FailureRecoveryPanel } from '@/components/tools/failure-recovery-panel';
import { ResultPanel } from '@/components/tools/result-panel';
import { ImageViewerModal } from '@/components/tools/image-viewer-modal';
import { ProcessingProgress } from '@/components/tools/processing-progress';
import { ImageGenerateCompare } from '@/components/tools/image-generate-compare';
import type { ToolStage } from '@/components/tools/tool-step-rail';
import {
  buildImageTryOnTaskPayload,
  MAX_TRY_ON_REFERENCES,
  ReferenceLibraryGrid,
  TRY_ON_PROMPT_MAX_LENGTH,
  type TryOnPersonSource,
  UploadReferenceCard,
  TryOnCompositionStrip,
  TryOnPresetsBar,
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
import { useObjectUrl } from '@/hooks/use-object-url';
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

const SCENE_CHIPS = [
  {
    labelZh: '纯白极简影棚',
    labelEn: 'Pure white studio',
    valueZh: '极简纯白影棚，无杂物无阴影',
    valueEn: 'Minimalist white studio, clean background without shadows',
  },
  {
    labelZh: '高级浅灰画册',
    labelEn: 'Minimalist grey backdrop',
    valueZh: '高级浅灰色背景，现代画册风格',
    valueEn: 'Neutral grey backdrop, modern lookbook aesthetic',
  },
  {
    labelZh: '柔和摄影棚漫射光',
    labelEn: 'Soft studio lighting',
    valueZh: '柔和摄影棚自然光，侧光漫射',
    valueEn: 'Soft diffused studio lighting, gentle side fill light',
  },
  {
    labelZh: '现代都市街拍',
    labelEn: 'Modern city street',
    valueZh: '极简现代都市街拍，自然景深',
    valueEn: 'Modern city street scene, natural depth of field',
  },
  {
    labelZh: '温暖午后咖啡厅',
    labelEn: 'Warm afternoon cafe',
    valueZh: '温暖午后街角咖啡厅，复古柔和光感',
    valueEn: 'Afternoon corner cafe, warm ambient light, vintage touch',
  },
  {
    labelZh: '海滨度假日光',
    labelEn: 'Coastal resort daylight',
    valueZh: '阳光明媚海滨度假风，通透清爽',
    valueEn: 'Sunny seaside resort vibe, bright and breezy natural daylight',
  },
];

export default function ImageTryOnPage() {
  const t = useTranslations('ImageTryOn');
  const tShell = useTranslations('ToolShell');
  const locale = useLocale();
  const isZh = locale.startsWith('zh');
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

  // 结果展示模式：单图 vs 滑动卷帘对比
  const [resultViewMode, setResultViewMode] = useState<'single' | 'compare'>(
    'single'
  );
  const [copied, setCopied] = useState(false);

  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerSrc, setViewerSrc] = useState('');

  const uploadedFileCacheRef = useRef<WeakMap<File, string>>(new WeakMap());
  const failedQuotaInvalidatedRef = useRef<Set<string>>(new Set());

  const taskProgressQuery = useTaskProgress(activeTask?.id ?? null);

  const garmentObjectUrl = useObjectUrl(garmentFile);
  const personObjectUrl = useObjectUrl(personFile);

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

  // 支持快捷键 Ctrl + Enter / Cmd + Enter 提交任务
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (canSubmit) {
          e.preventDefault();
          void handleSubmit();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canSubmit]);

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

  // 应用快速体验预设
  const handleApplyPreset = (preset: {
    personAssetId: string;
    garmentAssetId: string;
    poseAssetId: string;
    promptAddition: string;
  }) => {
    setMode('inspiration');
    setPersonSource('library');
    setPersonAssetId(preset.personAssetId);
    setPersonFile(null);
    setGarmentAssetId(preset.garmentAssetId);
    setGarmentFile(null);
    setPoseAssetId(preset.poseAssetId);
    setPromptAddition(preset.promptAddition);
    setError(null);
  };

  const handleToggleSceneChip = (chipValue: string) => {
    setPromptAddition(prev => {
      const trimmed = prev.trim();
      const delimiter = isZh ? '，' : ', ';
      if (trimmed.includes(chipValue)) {
        const cleaned = trimmed
          .replace(
            new RegExp(
              `(，\\s*${chipValue}|${chipValue}，?|\\b${chipValue}\\b)`,
              'g'
            ),
            ''
          )
          .trim();
        return cleaned.replace(/^[，,\s]+|[，,\s]+$/g, '');
      }
      return trimmed ? `${trimmed}${delimiter}${chipValue}` : chipValue;
    });
    setError(null);
  };

  const models = modelsQuery.data ?? [];

  const selectedPersonAsset = useMemo(() => {
    if (!personAssetId) return null;
    return (
      (personLibraryQuery.data ?? []).find(item => item.id === personAssetId) ??
      null
    );
  }, [personAssetId, personLibraryQuery.data]);

  const selectedGarmentAsset = useMemo(() => {
    if (!garmentAssetId) return null;
    return (
      (garmentLibraryQuery.data ?? []).find(
        item => item.id === garmentAssetId
      ) ?? null
    );
  }, [garmentAssetId, garmentLibraryQuery.data]);

  const selectedPoseAsset = useMemo(() => {
    if (!poseAssetId) return null;
    return (
      (poseLibraryQuery.data ?? []).find(item => item.id === poseAssetId) ??
      null
    );
  }, [poseAssetId, poseLibraryQuery.data]);

  const selectedStyleAsset = useMemo(() => {
    if (!styleAssetId) return null;
    return (
      (garmentLibraryQuery.data ?? []).find(item => item.id === styleAssetId) ??
      null
    );
  }, [styleAssetId, garmentLibraryQuery.data]);

  // 前后对比物料图 URL（优先使用目标服装，其次模特人像）
  const comparisonBeforeUrl = useMemo(() => {
    if (garmentObjectUrl) return garmentObjectUrl;
    if (selectedGarmentAsset?.thumbnailUrl)
      return selectedGarmentAsset.thumbnailUrl;
    if (personObjectUrl) return personObjectUrl;
    if (selectedPersonAsset?.thumbnailUrl)
      return selectedPersonAsset.thumbnailUrl;
    return '';
  }, [
    garmentObjectUrl,
    personObjectUrl,
    selectedGarmentAsset,
    selectedPersonAsset,
  ]);

  const taskFailureMessage = useMemo(() => {
    if (effectiveTask?.status !== 'failed') return null;
    const code = effectiveTask.errorCode;
    const mapped = code ? SUBMIT_ERROR_KEYS[code] : undefined;
    if (mapped) return t(`errors.${mapped}`);
    return effectiveTask.errorMessage || t('errors.failed');
  }, [effectiveTask, t]);

  const progressPercent =
    effectiveTask?.status === 'processing'
      ? Math.max(10, effectiveTask.progress)
      : 5;

  const progressLabel =
    effectiveTask?.status === 'pending'
      ? t('queued')
      : submitting
        ? t('submitting')
        : t('processing');

  const dynamicProgressPhase = useMemo(() => {
    if (progressPercent < 25) return t('phases.phase1');
    if (progressPercent < 55) return t('phases.phase2');
    if (progressPercent < 85) return t('phases.phase3');
    return t('phases.phase4');
  }, [progressPercent, t]);

  const submitGuideMessage = useMemo(() => {
    if (canSubmit || isBusy) return null;
    if (quotaExhausted) return t('quotaExhausted');
    if (!hasPerson && !hasGarment) return t('submitMissingBoth');
    if (!hasPerson) return t('submitMissingPerson');
    if (!hasGarment) return t('submitMissingGarment');
    if (promptTooLong) return t('errors.promptTooLong');
    return null;
  }, [
    canSubmit,
    hasGarment,
    hasPerson,
    isBusy,
    promptTooLong,
    quotaExhausted,
    t,
  ]);

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
      <div className="space-y-4 rounded-xl border border-border bg-card p-4">
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
                    ? 'bg-foreground text-background font-medium'
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
                    ? 'bg-foreground text-background font-medium'
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

        {/* 快速体验灵感预设条 */}
        <TryOnPresetsBar
          personLibrary={personLibraryQuery.data ?? []}
          garmentLibrary={garmentLibraryQuery.data ?? []}
          poseLibrary={poseLibraryQuery.data ?? []}
          disabled={isBusy}
          onApplyPreset={handleApplyPreset}
        />

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

      {/* 4 大要素配置区域（2x2 网格） */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 1. 人像参考（必选） */}
        <section
          id="try-on-section-person"
          className="space-y-3 rounded-xl border border-border bg-card p-4 transition-all"
        >
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
                    ? 'bg-foreground text-background font-medium'
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
                    ? 'bg-foreground text-background font-medium'
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
              showQuickPicks
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
        <section
          id="try-on-section-garment"
          className="space-y-3 rounded-xl border border-border bg-card p-4 transition-all"
        >
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
        <section
          id="try-on-section-pose"
          className="space-y-3 rounded-xl border border-border bg-card p-4 transition-all"
        >
          <div>
            <h2 className="text-sm font-medium">{t('poseSectionTitle')}</h2>
            <p className="text-xs text-muted-foreground">
              {t('poseSectionHint')}
            </p>
          </div>

          <ReferenceLibraryGrid
            role="pose"
            showQuickPicks
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
        <section
          id="try-on-section-style"
          className="space-y-3 rounded-xl border border-border bg-card p-4 transition-all"
        >
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

      {/* 穿搭搭配即时看板（总览与快速检查） */}
      <TryOnCompositionStrip
        personFile={personFile}
        personAsset={selectedPersonAsset}
        onClearPerson={() => {
          setPersonFile(null);
          setPersonAssetId(null);
        }}
        garmentFile={garmentFile}
        garmentAsset={selectedGarmentAsset}
        onClearGarment={() => {
          setGarmentFile(null);
          setGarmentAssetId(null);
        }}
        poseAsset={selectedPoseAsset}
        onClearPose={() => setPoseAssetId(null)}
        styleAsset={selectedStyleAsset}
        onClearStyle={() => setStyleAssetId(null)}
        onResetAll={handleReset}
        disabled={isBusy}
      />

      {/* 5. 场景补充说明与生成参数（可选） */}
      <section className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">{t('promptSectionTitle')}</h2>
          {promptAddition && (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setPromptAddition('')}
              className="inline-flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <X className="h-3 w-3" />
              {t('clearPrompt')}
            </button>
          )}
        </div>

        {/* 场景与光影快捷标签推荐 */}
        <div className="space-y-2">
          <span className="font-mono text-[11px] text-muted-foreground">
            {t('sceneChipsLabel')}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {SCENE_CHIPS.map(chip => {
              const label = isZh ? chip.labelZh : chip.labelEn;
              const val = isZh ? chip.valueZh : chip.valueEn;
              const isActive = promptAddition.includes(val);
              return (
                <button
                  key={chip.labelZh}
                  type="button"
                  disabled={isBusy}
                  onClick={() => handleToggleSceneChip(val)}
                  className={`rounded-full px-2.5 py-1 text-xs transition-all ${
                    isActive
                      ? 'border border-foreground bg-foreground text-background font-medium'
                      : 'border border-border bg-muted/30 text-muted-foreground hover:border-foreground/50 hover:text-foreground'
                  } disabled:opacity-50`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

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

        <div className="space-y-2 pt-1">
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

          {/* 提交按钮下方防呆提示与快捷键说明 */}
          <div className="text-center font-mono text-xs">
            {submitGuideMessage ? (
              <span className="text-amber-600 dark:text-amber-400">
                {submitGuideMessage}
              </span>
            ) : (
              <span className="text-muted-foreground/80">
                {t('submitShortcut')}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* 排队 / 处理中状态（阶段动态反馈） */}
      {isBusy && (
        <div className="space-y-1.5">
          <ProcessingProgress
            progress={progressPercent}
            label={progressLabel}
          />
          {effectiveTask?.status === 'processing' && (
            <p className="text-center font-mono text-xs text-muted-foreground animate-pulse">
              {dynamicProgressPhase}
            </p>
          )}
        </div>
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
                      garmentFile || selectedGarmentAsset
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
    </ToolPageShell>
  );
}
