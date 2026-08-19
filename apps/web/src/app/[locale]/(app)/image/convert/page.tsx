'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { formatBytes } from '@/lib/format';
import { FileDropzone } from '@/components/tools/file-dropzone';
import {
  ImageConvertOptions,
  CONVERT_FORMATS,
  type ImageConvertOptionsState,
} from '@/components/tools/image-convert-options';
import { ModeToggle, type ProcessMode } from '@/components/tools/mode-toggle';
import { ProcessingProgress } from '@/components/tools/processing-progress';
import { ImageCompare } from '@/components/tools/image-compare';
import { DownloadButton } from '@/components/tools/download-button';
import { ToolPageShell } from '@/components/tools/tool-page-shell';
import { FailureRecoveryPanel } from '@/components/tools/failure-recovery-panel';
import { ResultPanel } from '@/components/tools/result-panel';
import {
  DEFAULT_IMAGE_TRANSFORM,
  ImageTransformOptions,
} from '@/components/tools/image-transform-options';
import {
  convertImageFormat,
  getConvertedImageName,
  SERVER_CONVERT_FORMATS,
  type ImageOutputType,
} from '@/lib/processing/image-convert-client';
import { shouldProcessLocally } from '@/lib/processing/image-client';
import { toServerTransformConfig } from '@/lib/processing/image-transform-client';
import { getToolByHref } from '@/lib/tools/tool-metadata';
import { useUploadFile } from '@/hooks/api/use-files';
import { useCreateTask } from '@/hooks/api/use-tasks';
import { useTaskProgress } from '@/hooks/api/use-task-progress';
import { useImageEncodingSupport } from '@/hooks/use-image-encoding-support';

export default function ConvertPage() {
  const t = useTranslations('ImageConvert');
  const tShell = useTranslations('ToolShell');
  const tShared = useTranslations('ToolsShared');
  const tUnits = useTranslations('Common.units');
  const locale = useLocale();
  const tool = getToolByHref('/image/convert')!;
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [resultFile, setResultFile] = useState<File | null>(null);
  const [options, setOptions] = useState<ImageConvertOptionsState>({
    toFormat: 'image/webp',
    quality: 90,
  });
  const [transform, setTransform] = useState(DEFAULT_IMAGE_TRANSFORM);
  const [mode, setMode] = useState<ProcessMode>('local');
  const [progress, setProgress] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const router = useRouter();
  const { data: session, isPending: sessionLoading } = authClient.useSession();
  const uploadFile = useUploadFile();
  const createTask = useCreateTask();

  const taskQuery = useTaskProgress(taskId, {
    onCompleted: async outputFileId => {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/files/${outputFileId}/download`,
        { credentials: 'include' }
      );
      const blob = await response.blob();
      const newName = getConvertedImageName(
        originalFile?.name ?? 'converted',
        options.toFormat
      );
      const file = new File([blob], newName, { type: blob.type });
      setResultFile(file);
      setProcessing(false);
      setTaskId(null);
    },
    onFailed: err => {
      setError(err.message);
      setProcessing(false);
      setTaskId(null);
    },
  });

  const locallyEncodable = useImageEncodingSupport(CONVERT_FORMATS);
  // 本地编码不了目标格式时(典型是 AVIF),必须走服务端,否则 canvas 会静默产出 PNG。
  const formatNeedsServer = !locallyEncodable.has(options.toFormat);
  const recommendation: ProcessMode =
    formatNeedsServer || (originalFile && !shouldProcessLocally(originalFile))
      ? 'server'
      : 'local';
  const needsServerLogin = mode === 'server' && !sessionLoading && !session;

  const handleDrop = (files: File[]) => {
    if (files[0]) {
      setOriginalFile(files[0]);
      setResultFile(null);
      setError(null);
      setProgress(0);
    }
  };

  const handleProcess = async () => {
    if (!originalFile) return;

    if (mode === 'local' && formatNeedsServer) {
      setError(t('formatNeedsServerError'));
      return;
    }

    if (mode === 'server' && !sessionLoading && !session) {
      const next = encodeURIComponent('/image/convert');
      router.push(`/login?next=${next}`);
      return;
    }

    setProcessing(true);
    setError(null);
    setProgress(0);
    setResultFile(null);

    try {
      if (mode === 'local') {
        setProgress(30);
        const result = await convertImageFormat(
          originalFile,
          options.toFormat as ImageOutputType,
          options.quality / 100,
          transform
        );
        setProgress(100);
        setResultFile(result);
        setProcessing(false);
      } else {
        const uploaded = await uploadFile.mutateAsync(originalFile);
        const task = await createTask.mutateAsync({
          type: 'convert',
          inputFileIds: [(uploaded as any).id],
          inputConfig: {
            toFormat: SERVER_CONVERT_FORMATS[options.toFormat],
            quality: options.quality,
            transform: toServerTransformConfig(transform),
          },
        });
        setTaskId(task.id);
      }
    } catch (err) {
      setError((err as Error).message);
      setProcessing(false);
    }
  };

  const serverProgress = taskQuery.data?.progress ?? 0;
  const currentProgress = mode === 'local' ? progress : serverProgress;
  const stage = resultFile
    ? 'result'
    : processing
      ? 'processing'
      : originalFile
        ? 'configure'
        : 'upload';

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
        accept={{
          'image/*': [
            '.jpg',
            '.jpeg',
            '.png',
            '.webp',
            '.avif',
            '.heic',
            '.heif',
          ],
        }}
        maxSize={50 * 1024 * 1024}
        onDrop={handleDrop}
        disabled={processing}
        hint={t('dropzoneHint')}
        processingLabel={
          mode === 'local' ? tShared('mode.local') : tShared('mode.server')
        }
      />

      {originalFile && (
        <div className="space-y-6">
          <div className="text-xs font-mono text-muted-foreground">
            {t('selected', {
              filename: originalFile.name,
              size: formatBytes(originalFile.size, tUnits, locale),
            })}
          </div>

          <ImageConvertOptions
            value={options}
            onChange={setOptions}
            disabled={processing}
            locallyEncodable={locallyEncodable}
            localMode={mode === 'local'}
          />

          <ImageTransformOptions
            value={transform}
            onChange={setTransform}
            disabled={processing}
          />

          <ModeToggle
            value={mode}
            onChange={setMode}
            recommendation={recommendation}
            disabled={processing}
            serverLoginRequired={needsServerLogin}
          />

          <button
            type="button"
            onClick={handleProcess}
            disabled={processing}
            className="w-full h-10 text-sm font-mono bg-foreground text-background rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {processing
              ? t('processing')
              : needsServerLogin
                ? tShared('mode.loginToUseServer')
                : t('start')}
          </button>
        </div>
      )}

      {processing && (
        <ProcessingProgress progress={currentProgress} stage="processing" />
      )}

      {error && (
        <FailureRecoveryPanel
          message={error}
          onRetry={handleProcess}
          onReset={() => {
            setOriginalFile(null);
            setResultFile(null);
            setError(null);
            setTaskId(null);
            setProgress(0);
          }}
        />
      )}

      {resultFile && originalFile && (
        <div className="space-y-6">
          <ImageCompare original={originalFile} result={resultFile} />
          <ResultPanel
            title={resultFile.name}
            description={tShell('result.ready')}
            meta={[
              {
                label: tShared('compare.original'),
                value: formatBytes(originalFile.size, tUnits, locale),
              },
              {
                label: tShared('compare.result'),
                value: formatBytes(resultFile.size, tUnits, locale),
              },
            ]}
            action={<DownloadButton file={resultFile} />}
          />
        </div>
      )}
    </ToolPageShell>
  );
}
