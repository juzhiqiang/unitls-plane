'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { formatBytes } from '@/lib/format';
import { FileDropzone } from '@/components/tools/file-dropzone';
import {
  ImageConvertOptions,
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
  convertImageFormat,
  type ImageOutputType,
} from '@/lib/processing/image-convert-client';
import { shouldProcessLocally } from '@/lib/processing/image-client';
import { getToolByHref } from '@/lib/tools/tool-metadata';
import { useUploadFile } from '@/hooks/api/use-files';
import { useCreateTask } from '@/hooks/api/use-tasks';
import { useTaskProgress } from '@/hooks/api/use-task-progress';

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
      const ext = options.toFormat.split('/')[1];
      const newName =
        originalFile?.name.replace(/\.[^.]+$/, `.${ext}`) ?? `converted.${ext}`;
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

  const recommendation: ProcessMode = originalFile
    ? shouldProcessLocally(originalFile)
      ? 'local'
      : 'server'
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
          options.quality / 100
        );
        setProgress(100);
        setResultFile(result);
        setProcessing(false);
      } else {
        const uploaded = await uploadFile.mutateAsync(originalFile);
        const formatMap: Record<string, string> = {
          'image/jpeg': 'jpeg',
          'image/webp': 'webp',
          'image/png': 'png',
        };
        const task = await createTask.mutateAsync({
          type: 'convert',
          inputFileIds: [(uploaded as any).id],
          inputConfig: {
            toFormat: formatMap[options.toFormat] ?? 'webp',
            quality: options.quality,
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
        accept={{ 'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.avif'] }}
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
