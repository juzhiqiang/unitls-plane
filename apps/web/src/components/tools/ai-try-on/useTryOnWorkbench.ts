'use client';

import { useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useRequireLogin } from '@/hooks/use-require-login';
import {
  useImageGenerateModels,
  useImageGenerateQuota,
} from '@/hooks/api/use-tasks';
import { useAiTryOnReferences } from '@/hooks/api/use-ai-try-on';
import { useObjectUrl } from '@/hooks/use-object-url';
import { getImageUploadMaxFileSize } from '@/lib/tools/image-limits';
import type { ToolStage } from '@/components/tools/tool-step-rail';
import { TRY_ON_PROMPT_MAX_LENGTH } from './types';
import { useTryOnForm } from './useTryOnForm';
import { useTryOnTask } from './useTryOnTask';

/** 汇总工作台查询和可提交状态，页面仅组合视图。 */
export function useTryOnWorkbench() {
  const t = useTranslations('ImageTryOn');
  const { session, requireLogin } = useRequireLogin();
  const maxFileSize = getImageUploadMaxFileSize(session);
  const quotaQuery = useImageGenerateQuota();
  const modelsQuery = useImageGenerateModels();
  const personLibraryQuery = useAiTryOnReferences('person');
  const garmentLibraryQuery = useAiTryOnReferences('garment');
  const poseLibraryQuery = useAiTryOnReferences('pose');
  const form = useTryOnForm();
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
  } = form;
  const garmentObjectUrl = useObjectUrl(garmentFile);
  const personObjectUrl = useObjectUrl(personFile);

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

  const task = useTryOnTask({
    form,
    requireLogin,
    quotaExhausted,
    requiredApiFailed,
    quotaLoadFailed,
    hasPerson,
    hasGarment,
  });
  const { isBusy, effectiveTask, submitting, handleSubmit } = task;
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
    form.setMode('product');
    form.setPersonSource('upload');
    task.setError(null);
    task.setErrorCode(undefined);
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
  }, [canSubmit, handleSubmit]);

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

  return {
    form,
    task,
    maxFileSize,
    quotaQuery,
    models,
    libraries: {
      person: personLibraryQuery,
      garment: garmentLibraryQuery,
      pose: poseLibraryQuery,
    },
    activeReferenceCount,
    quotaExhausted,
    quotaLoadFailed,
    requiredApiFailed,
    promptTooLong,
    canSubmit,
    stage,
    selectedPersonAsset,
    selectedGarmentAsset,
    selectedPoseAsset,
    selectedStyleAsset,
    comparisonBeforeUrl,
    progressPercent,
    progressLabel,
    dynamicProgressPhase,
    submitGuideMessage,
    handleFallbackToUpload,
  };
}

export type TryOnWorkbench = ReturnType<typeof useTryOnWorkbench>;
