'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { api } from '@/lib/api-client';
import { FileDropzone } from '@/components/tools/file-dropzone';
import {
  DEFAULT_IMAGE_COMPRESS_OPTIONS,
  ImageCompressOptions,
  type ImageCompressOptionsState,
  type CompressFormat,
  toCompressOptions,
  resolveSize,
} from '@/components/tools/image-compress-options';
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
  compressImage,
  shouldProcessLocally,
} from '@/lib/processing/image-client';
import { toServerTransformConfig } from '@/lib/processing/image-transform-client';
import { getToolByHref } from '@/lib/tools/tool-metadata';
import { useUploadFile } from '@/hooks/api/use-files';
import { useCreateTask } from '@/hooks/api/use-tasks';
import { getImageCompressionIndices } from './image-compress-utils';

const SUPPORTED_OUTPUT_TYPES = new Set<CompressFormat>([
  'image/jpeg',
  'image/webp',
  'image/png',
]);

function detectOutputType(file: File): CompressFormat | null {
  const t = file.type as CompressFormat;
  if (SUPPORTED_OUTPUT_TYPES.has(t)) return t;
  if (file.type === 'image/jpg') return 'image/jpeg';
  return null;
}

function compressedName(file: File, outputType: CompressFormat): string {
  const extMap: Record<CompressFormat, string> = {
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/png': 'png',
  };
  const ext = extMap[outputType];
  const dot = file.name.lastIndexOf('.');
  const base = dot > 0 ? file.name.slice(0, dot) : file.name;
  return `compressed-${base}.${ext}`;
}

async function processOnServer(
  file: File,
  config: Record<string, unknown>,
  uploadMutate: (file: File) => Promise<unknown>,
  createTaskMutate: (input: any) => Promise<{ id: string }>,
  outputType: CompressFormat
): Promise<File> {
  const uploaded = (await uploadMutate(file)) as { id: string };
  const task = await createTaskMutate({
    type: 'compress',
    inputFileIds: [uploaded.id],
    inputConfig: config,
  });

  while (true) {
    const { data, error } = await api.GET('/tasks/{id}/status', {
      params: { path: { id: task.id } },
    });
    if (error) throw new Error('Failed to poll task status');
    if (data?.status === 'completed') {
      const outputFileId = (data as any).outputFileId as string;
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/files/${outputFileId}/download`,
        { credentials: 'include' }
      );
      if (!response.ok) throw new Error('Failed to download result');
      const blob = await response.blob();
      return new File([blob], compressedName(file, outputType), {
        type: blob.type,
      });
    }
    if (data?.status === 'failed') {
      throw new Error((data as any).errorMessage ?? 'Task failed');
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}

export default function CompressPage() {
  const t = useTranslations('ImageCompress');
  const tShell = useTranslations('ToolShell');
  const tShared = useTranslations('ToolsShared');
  const tool = getToolByHref('/image/compress')!;
  const [items, setItems] = useState<FileItem[]>([]);
  const [options, setOptions] = useState<ImageCompressOptionsState>(
    DEFAULT_IMAGE_COMPRESS_OPTIONS
  );
  const [transform, setTransform] = useState(DEFAULT_IMAGE_TRANSFORM);
  const [mode, setMode] = useState<ProcessMode>('local');
  const [progress, setProgress] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const router = useRouter();
  const { data: session, isPending: sessionLoading } = authClient.useSession();
  const uploadFile = useUploadFile();
  const createTask = useCreateTask();

  const recommendation: ProcessMode =
    items.length > 0
      ? items.every(it => shouldProcessLocally(it.file))
        ? 'local'
        : 'server'
      : 'local';
  const needsServerLogin = mode === 'server' && !sessionLoading && !session;

  const handleDrop = (files: File[]) => {
    if (files.length === 0) return;

    const newItems: FileItem[] = files.map(file => ({
      file,
      status: 'pending' as const,
    }));

    setItems(prev => {
      // First batch ever: auto-detect output type from the first file
      if (prev.length === 0 && files[0]) {
        const detected = detectOutputType(files[0]);
        if (detected) {
          setOptions(o => ({ ...o, outputType: detected }));
        }
      }
      return [...prev, ...newItems];
    });

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
    if (items.length === 0) return;

    if (mode === 'server' && !sessionLoading && !session) {
      const next = encodeURIComponent('/image/compress');
      router.push(`/login?next=${next}`);
      return;
    }

    const indicesToProcess = getImageCompressionIndices(items);

    if (indicesToProcess.length === 0) return;

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

    const formatMap: Record<CompressFormat, string> = {
      'image/jpeg': 'jpeg',
      'image/webp': 'webp',
      'image/png': 'png',
    };
    const { width, height } = resolveSize(options);

    const tasks = indicesToProcess.map(async i => {
      const item = items[i]!;
      updateItem(i, { status: 'processing' });
      try {
        let result: File;
        if (mode === 'local') {
          result = await compressImage(item.file, {
            ...toCompressOptions(options),
            transform,
            onProgress: p => {
              fileProgress[i] = p;
              updateOverall();
            },
          });
        } else {
          const config: Record<string, unknown> = {
            format: formatMap[options.outputType] ?? 'jpeg',
            quality: options.quality,
            ...(width !== undefined && { maxWidth: width }),
            ...(height !== undefined && { maxHeight: height }),
            transform: toServerTransformConfig(transform),
          };
          result = await processOnServer(
            item.file,
            config,
            f => uploadFile.mutateAsync(f),
            input => createTask.mutateAsync(input) as Promise<{ id: string }>,
            options.outputType
          );
          fileProgress[i] = 100;
          updateOverall();
        }
        updateItem(i, { result, status: 'done' });
      } catch (err) {
        const message = (err as Error).message;
        updateItem(i, { status: 'failed', error: message });
        fileProgress[i] = 100;
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
        accept={{ 'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.avif'] }}
        maxSize={50 * 1024 * 1024}
        multiple
        onDrop={handleDrop}
        disabled={processing}
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

          <ImageCompressOptions
            value={options}
            onChange={setOptions}
            disabled={processing}
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
                : `compressed-${successResults.length}-files.zip`
            }
            description={
              successResults.length === 1
                ? tShell('result.ready')
                : tShell('result.filesReady', { count: successResults.length })
            }
            action={
              successResults.length === 1 ? (
                <DownloadButton file={successResults[0]!} />
              ) : (
                <ZipDownloadButton
                  files={successResults}
                  zipName={`compressed-${successResults.length}-files.zip`}
                />
              )
            }
          />
        </div>
      )}
    </ToolPageShell>
  );
}
