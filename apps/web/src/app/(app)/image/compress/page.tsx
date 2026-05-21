'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { FileDropzone } from '@/components/tools/file-dropzone';
import {
  ImageCompressOptions,
  type ImageCompressOptionsState,
  toCompressOptions,
} from '@/components/tools/image-compress-options';
import { ModeToggle, type ProcessMode } from '@/components/tools/mode-toggle';
import { ProcessingProgress } from '@/components/tools/processing-progress';
import { ImageCompare } from '@/components/tools/image-compare';
import { DownloadButton } from '@/components/tools/download-button';
import {
  compressImage,
  shouldProcessLocally,
} from '@/lib/processing/image-client';
import { useUploadFile } from '@/hooks/api/use-files';
import { useCreateTask } from '@/hooks/api/use-tasks';
import { useTaskProgress } from '@/hooks/api/use-task-progress';

export default function CompressPage() {
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [resultFile, setResultFile] = useState<File | null>(null);
  const [options, setOptions] = useState<ImageCompressOptionsState>({
    quality: 80,
    maxWidthOrHeight: 1920,
    outputType: 'image/jpeg',
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
    onCompleted: async (outputFileId) => {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/files/${outputFileId}/download`,
        { credentials: 'include' },
      );
      const blob = await response.blob();
      const file = new File([blob], `compressed-${originalFile?.name}`, {
        type: blob.type,
      });
      setResultFile(file);
      setProcessing(false);
      setTaskId(null);
    },
    onFailed: (err) => {
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
      const next = encodeURIComponent('/image/compress');
      router.push(`/login?next=${next}`);
      return;
    }

    setProcessing(true);
    setError(null);
    setProgress(0);
    setResultFile(null);

    try {
      if (mode === 'local') {
        const result = await compressImage(originalFile, {
          ...toCompressOptions(options),
          onProgress: (p) => setProgress(p),
        });
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
          type: 'compress',
          inputFileIds: [(uploaded as any).id],
          inputConfig: {
            format: formatMap[options.outputType] ?? 'jpeg',
            quality: options.quality,
            maxWidth: options.maxWidthOrHeight,
            maxHeight: options.maxWidthOrHeight,
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

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-lg font-medium">图片压缩</h1>
        <p className="text-sm text-muted-foreground mt-1">
          减小图片文件大小，支持 JPEG / WebP / PNG
        </p>
      </div>

      <FileDropzone
        accept={{ 'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.avif'] }}
        maxSize={50 * 1024 * 1024}
        onDrop={handleDrop}
        disabled={processing}
        hint="支持 JPG / PNG / WebP / AVIF，最大 50MB"
      />

      {originalFile && (
        <div className="space-y-6">
          <div className="text-xs font-mono text-muted-foreground">
            已选择: {originalFile.name} ({(originalFile.size / 1024).toFixed(1)}{' '}
            KB)
          </div>

          <ImageCompressOptions
            value={options}
            onChange={setOptions}
            disabled={processing}
          />

          <ModeToggle
            value={mode}
            onChange={setMode}
            recommendation={recommendation}
            disabled={processing}
          />

          <button
            type="button"
            onClick={handleProcess}
            disabled={processing}
            className="w-full h-10 text-sm font-mono bg-foreground text-background rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {processing ? '处理中...' : '开始压缩'}
          </button>
        </div>
      )}

      {processing && <ProcessingProgress progress={currentProgress} />}

      {error && (
        <div className="text-xs font-mono text-destructive p-3 border border-destructive/30 rounded-md">
          {error}
        </div>
      )}

      {resultFile && originalFile && (
        <div className="space-y-6">
          <ImageCompare original={originalFile} result={resultFile} />
          <DownloadButton file={resultFile} />
        </div>
      )}
    </div>
  );
}
