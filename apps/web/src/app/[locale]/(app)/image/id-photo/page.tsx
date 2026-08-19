'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { formatBytes } from '@/lib/format';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { FailureRecoveryPanel } from '@/components/tools/failure-recovery-panel';
import {
  IdPhotoOptions,
  type IdPhotoOptionsState,
} from '@/components/tools/id-photo-options';
import { IdPhotoCropField } from '@/components/tools/id-photo-crop';
import { IdPhotoSheetPanel } from '@/components/tools/id-photo-sheet-panel';
import { idPhotoPresetSpecs } from '@utils-plane/validators';
import { ProcessingProgress } from '@/components/tools/processing-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { ToolPageShell } from '@/components/tools/tool-page-shell';
import type { ToolStage } from '@/components/tools/tool-step-rail';
import { DownloadButton } from '@/components/tools/download-button';
import { getToolByHref } from '@/lib/tools/tool-metadata';
import { useUploadFile } from '@/hooks/api/use-files';
import { useCreateTask } from '@/hooks/api/use-tasks';
import { useTaskProgress } from '@/hooks/api/use-task-progress';
import { useObjectUrl } from '@/hooks/use-object-url';
import { useLocalIdPhoto } from '@/lib/id-photo-local/use-local-id-photo';
import { ModeToggle, type ProcessMode } from '@/components/tools/mode-toggle';

const DEFAULT_OPTIONS: IdPhotoOptionsState = {
  preset: 'one_inch',
  backgroundColor: '#438edb',
  outputType: 'image/jpeg',
  segmentationMode: 'local',
  crop: { x: 0.5, y: 0.5, scale: 1 },
};

export default function IdPhotoPage() {
  const t = useTranslations('ImageIdPhoto');
  const tShell = useTranslations('ToolShell');
  const tUnits = useTranslations('Common.units');
  const locale = useLocale();
  const tool = getToolByHref('/image/id-photo')!;
  const router = useRouter();
  const { data: session, isPending: sessionLoading } = authClient.useSession();
  const uploadFile = useUploadFile();
  const createTask = useCreateTask();

  const [file, setFile] = useState<File | null>(null);
  const [resultFile, setResultFile] = useState<File | null>(null);
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processingMode, setProcessingMode] = useState<ProcessMode>('local');
  const [highPrecision, setHighPrecision] = useState(false);

  const sourceUrl = useObjectUrl(file);
  const resultUrl = useObjectUrl(resultFile);
  const local = useLocalIdPhoto();
  const localResultUrl = useObjectUrl(local.resultBlob);

  const taskQuery = useTaskProgress(taskId, {
    onCompleted: async outputFileId => {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/files/${outputFileId}/download`,
        { credentials: 'include' }
      );
      const blob = await response.blob();
      const ext = options.outputType === 'image/png' ? 'png' : 'jpg';
      setResultFile(new File([blob], `id-photo.${ext}`, { type: blob.type }));
      setProcessing(false);
      setTaskId(null);
    },
    onFailed: err => {
      setError(err.message);
      setProcessing(false);
      setTaskId(null);
    },
  });

  const handleDrop = (files: File[]) => {
    if (!files[0]) return;
    setFile(files[0]);
    setResultFile(null);
    setError(null);
  };

  const handleProcess = async () => {
    if (processingMode === 'local') {
      if (!file) return;
      await local.process(file, highPrecision ? 'high' : 'balanced', {
        preset: options.preset,
        backgroundColor: options.backgroundColor,
        outputType: options.outputType,
        crop: options.crop,
      });
      return;
    }
    // —— 以下为服务端逻辑,保持不变 ——
    if (!file) return;
    if (!sessionLoading && !session) {
      router.push(`/login?next=${encodeURIComponent('/image/id-photo')}`);
      return;
    }

    setProcessing(true);
    setError(null);
    setResultFile(null);

    try {
      const uploaded = await uploadFile.mutateAsync(file);
      const task = await createTask.mutateAsync({
        type: 'image_id_photo',
        inputFileIds: [(uploaded as any).id],
        inputConfig: {
          preset: options.preset,
          backgroundColor: options.backgroundColor,
          outputType: options.outputType,
          segmentationMode: options.segmentationMode,
          dpi: 300,
          crop: options.crop,
        },
      });
      setTaskId(task.id);
    } catch (err) {
      setError((err as Error).message);
      setProcessing(false);
    }
  };

  const localProcessing =
    local.status === 'loading-model' ||
    local.status === 'running' ||
    local.status === 'compositing';
  const isProcessing =
    processingMode === 'local' ? localProcessing : processing;
  const hasResult =
    processingMode === 'local' ? !!local.resultBlob : !!resultFile;
  const stage: ToolStage = hasResult
    ? 'result'
    : isProcessing
      ? 'processing'
      : file
        ? 'configure'
        : 'upload';
  const localStageKey =
    local.status === 'loading-model'
      ? 'loadingModel'
      : local.status === 'running'
        ? 'running'
        : 'compositing';
  const buttonLabel = isProcessing
    ? processingMode === 'local'
      ? t(`localStages.${localStageKey}`)
      : t('processing')
    : t('start');
  const ext = options.outputType === 'image/png' ? 'png' : 'jpg';
  const localResultFile = local.resultBlob
    ? new File([local.resultBlob], `id-photo.${ext}`, {
        type: options.outputType,
      })
    : null;
  // 两条路产出的成品照,拼版面板只关心「有没有」,不关心来自哪条
  const finishedPhoto =
    processingMode === 'local' ? local.resultBlob : resultFile;

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
      <FileDropzone
        accept={{ 'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.avif'] }}
        maxSize={50 * 1024 * 1024}
        onDrop={handleDrop}
        disabled={isProcessing}
        hint={t('dropzoneHint')}
        processingLabel={t('processingLabel')}
      />

      {file && (
        <div className="space-y-6">
          {sourceUrl && (
            <IdPhotoCropField
              imageUrl={sourceUrl}
              presetWidth={idPhotoPresetSpecs[options.preset].widthPx}
              presetHeight={idPhotoPresetSpecs[options.preset].heightPx}
              value={options.crop}
              onChange={crop => setOptions(o => ({ ...o, crop }))}
              disabled={isProcessing}
              t={t}
            />
          )}

          <div className="text-xs font-mono text-muted-foreground">
            {t('selected', {
              filename: file.name,
              size: formatBytes(file.size, tUnits, locale),
            })}
          </div>

          <IdPhotoOptions
            value={options}
            onChange={setOptions}
            disabled={isProcessing}
            t={t}
            mode={processingMode}
            highPrecision={highPrecision}
            highPrecisionDisabled={local.ep !== 'webgpu'}
            onHighPrecisionChange={setHighPrecision}
          />

          <ModeToggle
            value={processingMode}
            onChange={m => {
              setProcessingMode(m);
              local.reset();
              setResultFile(null);
              setError(null);
            }}
            disabled={isProcessing}
          />

          <button
            type="button"
            onClick={handleProcess}
            disabled={isProcessing}
            className="h-10 w-full rounded-md bg-foreground text-sm font-mono text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {buttonLabel}
          </button>
        </div>
      )}

      {isProcessing && (
        <ProcessingProgress
          progress={
            processingMode === 'local'
              ? local.status === 'loading-model'
                ? Math.round(local.progress * 100)
                : local.status === 'running'
                  ? 60
                  : 90
              : (taskQuery.data?.progress ?? 5)
          }
          label={buttonLabel}
        />
      )}

      {(processingMode === 'local' ? local.error : error) && (
        <FailureRecoveryPanel
          // @imgly 均衡档(isnet_fp16)在 CPU 也能本地处理,失败一律用通用文案;
          // 高精度需要 WebGPU 的限制已由 highPrecisionDisabled 开关单独表达。
          message={
            processingMode === 'local' ? t('localFailed') : (error ?? '')
          }
          onRetry={handleProcess}
          onReset={() => {
            setFile(null);
            local.reset();
          }}
        />
      )}

      {processingMode === 'local' && localResultFile && (
        <ResultPanel
          title={t('resultTitle')}
          description={`id-photo.${ext}`}
          preview={
            localResultUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={localResultUrl}
                alt={t('previewAlt')}
                className="mx-auto max-h-80 w-auto object-contain rounded-md border border-border"
              />
            ) : null
          }
          meta={[]}
          action={<DownloadButton file={localResultFile} />}
        />
      )}

      {processingMode === 'server' && resultFile && (
        <ResultPanel
          title={t('resultTitle')}
          description={resultFile.name}
          preview={
            resultUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={resultUrl}
                alt={t('previewAlt')}
                className="mx-auto max-h-80 w-auto object-contain rounded-md border border-border"
              />
            ) : null
          }
          meta={[
            {
              label: t('resultSize'),
              value: formatBytes(resultFile.size, tUnits, locale),
            },
          ]}
          action={<DownloadButton file={resultFile} />}
        />
      )}

      {/* 拼版对两条处理路是同一件事:拿到成品照后纯本地合成,不区分来源 */}
      {finishedPhoto && (
        <IdPhotoSheetPanel
          photo={finishedPhoto}
          photoWidthPx={idPhotoPresetSpecs[options.preset].widthPx}
          photoHeightPx={idPhotoPresetSpecs[options.preset].heightPx}
          outputType={options.outputType}
          t={t}
        />
      )}
    </ToolPageShell>
  );
}
