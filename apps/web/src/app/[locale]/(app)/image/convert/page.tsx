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
import { ZipDownloadButton } from '@/components/tools/zip-download-button';
import { FileList, type FileItem } from '@/components/tools/file-list';
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
import { runImageTask } from '@/lib/processing/run-image-task';
import { toServerTransformConfig } from '@/lib/processing/image-transform-client';
import { getToolByHref } from '@/lib/tools/tool-metadata';
import { getImageUploadMaxFileSize } from '@/lib/tools/image-limits';
import { useUploadFile } from '@/hooks/api/use-files';
import { useCreateTask } from '@/hooks/api/use-tasks';
import { useImageEncodingSupport } from '@/hooks/use-image-encoding-support';

export default function ConvertPage() {
  const t = useTranslations('ImageConvert');
  const tShell = useTranslations('ToolShell');
  const tShared = useTranslations('ToolsShared');
  const tUnits = useTranslations('Common.units');
  const locale = useLocale();
  const tool = getToolByHref('/image/convert')!;
  const [items, setItems] = useState<FileItem[]>([]);
  const [options, setOptions] = useState<ImageConvertOptionsState>({
    toFormat: 'image/webp',
    quality: 90,
  });
  const [transform, setTransform] = useState(DEFAULT_IMAGE_TRANSFORM);
  const [mode, setMode] = useState<ProcessMode>('local');
  const [progress, setProgress] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const router = useRouter();
  const { data: session, isPending: sessionLoading } = authClient.useSession();
  // 这三个工具可能把图片发到服务端,因此受账号额度约束(纯本地工具不受)。
  const maxFileSize = getImageUploadMaxFileSize(session);
  const uploadFile = useUploadFile();
  const createTask = useCreateTask();

  const locallyEncodable = useImageEncodingSupport(CONVERT_FORMATS);
  // 本地编码不了目标格式时(典型是 AVIF),必须走服务端,否则 canvas 会静默产出 PNG。
  const formatNeedsServer = !locallyEncodable.has(options.toFormat);
  const recommendation: ProcessMode =
    formatNeedsServer ||
    (items.length > 0 && !items.every(it => shouldProcessLocally(it.file)))
      ? 'server'
      : 'local';
  const needsServerLogin = mode === 'server' && !sessionLoading && !session;
  const controlsDisabled = processing || sessionLoading;

  const handleDrop = (files: File[]) => {
    if (files.length === 0) return;
    setItems(prev => [
      ...prev,
      ...files.map(file => ({ file, status: 'pending' as const })),
    ]);
    setGlobalError(null);
    setProgress(0);
  };

  const handleRemove = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, patch: Partial<FileItem>) => {
    setItems(prev =>
      prev.map((it, i) => (i === index ? { ...it, ...patch } : it))
    );
  };

  const handleProcess = async () => {
    if (sessionLoading || items.length === 0) return;

    if (mode === 'local' && formatNeedsServer) {
      setGlobalError(t('formatNeedsServerError'));
      return;
    }

    if (mode === 'server' && !sessionLoading && !session) {
      const next = encodeURIComponent('/image/convert');
      router.push(`/login?next=${next}`);
      return;
    }

    setProcessing(true);
    setGlobalError(null);
    setProgress(0);
    setItems(prev =>
      prev.map(it => ({ file: it.file, status: 'pending' as const }))
    );

    const fileProgress: number[] = items.map(() => 0);
    const updateOverall = () => {
      const sum = fileProgress.reduce((a, b) => a + b, 0);
      setProgress(Math.round(sum / items.length));
    };
    updateOverall();

    const tasks = items.map(async (item, index) => {
      updateItem(index, { status: 'processing' });
      try {
        const outputName = getConvertedImageName(
          item.file.name,
          options.toFormat
        );
        let result: File;

        if (mode === 'local') {
          result = await convertImageFormat(
            item.file,
            options.toFormat as ImageOutputType,
            options.quality / 100,
            transform
          );
        } else {
          result = await runImageTask({
            file: item.file,
            type: 'convert',
            inputConfig: {
              toFormat: SERVER_CONVERT_FORMATS[options.toFormat],
              quality: options.quality,
              transform: toServerTransformConfig(transform),
            },
            outputName,
            upload: file => uploadFile.mutateAsync(file),
            createTask: input =>
              createTask.mutateAsync(input as never) as Promise<{ id: string }>,
            onProgress: value => {
              fileProgress[index] = value;
              updateOverall();
            },
          });
        }

        fileProgress[index] = 100;
        updateOverall();
        updateItem(index, { result, status: 'done' });
      } catch (err) {
        updateItem(index, {
          status: 'failed',
          error: (err as Error).message,
        });
        fileProgress[index] = 100;
        updateOverall();
      }
    });

    await Promise.all(tasks);
    setProcessing(false);
  };

  const isSingle = items.length === 1;
  const singleItem = isSingle ? items[0] : null;
  const successResults = items
    .filter(it => it.status === 'done' && it.result)
    .map(it => it.result as File);
  const hasAnyResult = successResults.length > 0;
  const stage = hasAnyResult
    ? 'result'
    : processing
      ? 'processing'
      : items.length > 0
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
        maxSize={maxFileSize}
        multiple
        onDrop={handleDrop}
        disabled={controlsDisabled}
        hint={t('dropzoneHint')}
        processingLabel={
          mode === 'local' ? tShared('mode.local') : tShared('mode.server')
        }
      />

      {items.length > 0 && (
        <div className="space-y-6">
          <FileList
            items={items}
            onRemove={handleRemove}
            disabled={processing}
          />

          <ImageConvertOptions
            value={options}
            onChange={setOptions}
            disabled={controlsDisabled}
            locallyEncodable={locallyEncodable}
            localMode={mode === 'local'}
          />

          <ImageTransformOptions
            value={transform}
            onChange={setTransform}
            disabled={controlsDisabled}
          />

          <ModeToggle
            value={mode}
            onChange={setMode}
            recommendation={recommendation}
            disabled={controlsDisabled}
            serverLoginRequired={needsServerLogin}
          />

          <button
            type="button"
            onClick={handleProcess}
            disabled={controlsDisabled}
            className="w-full h-10 text-sm font-mono bg-foreground text-background rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {processing
              ? t('processing')
              : needsServerLogin
                ? tShared('mode.loginToUseServer')
                : items.length > 1
                  ? t('startWithCount', { count: items.length })
                  : t('start')}
          </button>
        </div>
      )}

      {processing && (
        <ProcessingProgress progress={progress} stage="processing" />
      )}

      {globalError && (
        <FailureRecoveryPanel
          message={globalError}
          onRetry={handleProcess}
          onReset={() => {
            setItems([]);
            setGlobalError(null);
            setProgress(0);
          }}
        />
      )}

      {hasAnyResult && (
        <div className="space-y-6">
          {isSingle && singleItem?.result && (
            <ImageCompare
              original={singleItem.file}
              result={singleItem.result}
            />
          )}

          <ResultPanel
            title={
              successResults.length === 1
                ? successResults[0]!.name
                : `converted-${successResults.length}-files.zip`
            }
            description={
              successResults.length === 1
                ? tShell('result.ready')
                : tShell('result.filesReady', { count: successResults.length })
            }
            meta={
              isSingle && singleItem?.result
                ? [
                    {
                      label: tShared('compare.original'),
                      value: formatBytes(singleItem.file.size, tUnits, locale),
                    },
                    {
                      label: tShared('compare.result'),
                      value: formatBytes(
                        singleItem.result.size,
                        tUnits,
                        locale
                      ),
                    },
                  ]
                : []
            }
            action={
              successResults.length === 1 ? (
                <DownloadButton file={successResults[0]!} />
              ) : (
                <ZipDownloadButton
                  files={successResults}
                  zipName={`converted-${successResults.length}-files.zip`}
                />
              )
            }
          />
        </div>
      )}
    </ToolPageShell>
  );
}
