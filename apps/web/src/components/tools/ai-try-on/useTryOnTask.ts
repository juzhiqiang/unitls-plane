'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { useUploadFile } from '@/hooks/api/use-files';
import { useCreateTask, useRetryTask } from '@/hooks/api/use-tasks';
import { useTaskProgress } from '@/hooks/api/use-task-progress';
import { taskQueryKeys } from '@/hooks/api/query-keys';
import type { AiTryOnMode } from '@/hooks/api/types';
import type { useRequireLogin } from '@/hooks/use-require-login';
import { buildImageTryOnTaskPayload } from './types';
import type { TryOnForm } from './useTryOnForm';

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

export interface ActiveTryOnTaskState {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  outputFileId?: string;
  errorCode?: string;
  errorMessage?: string;
  mode: AiTryOnMode;
}

interface TryOnTaskOptions {
  form: TryOnForm;
  requireLogin: ReturnType<typeof useRequireLogin>['requireLogin'];
  quotaExhausted: boolean;
  requiredApiFailed: boolean;
  quotaLoadFailed: boolean;
  hasPerson: boolean;
  hasGarment: boolean;
}

/** 管理上传复用、任务提交/重试和失败后的共享额度刷新。 */
export function useTryOnTask({
  form,
  requireLogin,
  quotaExhausted,
  requiredApiFailed,
  quotaLoadFailed,
  hasPerson,
  hasGarment,
}: TryOnTaskOptions) {
  const t = useTranslations('ImageTryOn');
  const queryClient = useQueryClient();
  const uploadFile = useUploadFile();
  const createTask = useCreateTask();
  const retryTask = useRetryTask();
  const {
    mode,
    personSource,
    personFile,
    personAssetId,
    garmentFile,
    garmentAssetId,
    poseAssetId,
    styleAssetId,
    promptAddition,
    size,
    quality,
    model,
  } = form;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [activeTask, setActiveTask] = useState<ActiveTryOnTaskState | null>(
    null
  );

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

  const resolveFileId = async (file: File): Promise<string> => {
    const cached = uploadedFileCacheRef.current.get(file);
    if (cached) return cached;
    // 上传端点尚未在 OpenAPI 中声明响应体，在消费边界检查需要的文件 ID。
    const uploaded: unknown = await uploadFile.mutateAsync(file);
    if (
      !uploaded ||
      typeof uploaded !== 'object' ||
      !('id' in uploaded) ||
      typeof uploaded.id !== 'string'
    ) {
      throw new Error('Upload response is missing a file ID');
    }
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
    form.resetSelections();
    setActiveTask(null);
    setError(null);
    setErrorCode(undefined);
  };

  const taskFailureMessage = useMemo(() => {
    if (effectiveTask?.status !== 'failed') return null;
    const code = effectiveTask.errorCode;
    const mapped = code ? SUBMIT_ERROR_KEYS[code] : undefined;
    if (mapped) return t(`errors.${mapped}`);
    return effectiveTask.errorMessage || t('errors.failed');
  }, [effectiveTask, t]);

  const isTaskRunning = Boolean(
    effectiveTask &&
    (effectiveTask.status === 'pending' ||
      effectiveTask.status === 'processing')
  );

  return {
    effectiveTask,
    submitting,
    isBusy: submitting || isTaskRunning,
    error,
    setError,
    errorCode,
    setErrorCode,
    taskFailureMessage,
    handleSubmit,
    handleRegenerate,
    handleReset,
  };
}

export type TryOnTask = ReturnType<typeof useTryOnTask>;
