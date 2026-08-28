'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { FileDropzone } from '@/components/tools/file-dropzone';
import {
  SortableFileList,
  type SortableFile,
} from '@/components/tools/sortable-file-list';
import { ProcessingProgress } from '@/components/tools/processing-progress';
import { DownloadButton } from '@/components/tools/download-button';
import { ToolPageShell } from '@/components/tools/tool-page-shell';
import { FailureRecoveryPanel } from '@/components/tools/failure-recovery-panel';
import { ResultPanel } from '@/components/tools/result-panel';
import { useUploadFile } from '@/hooks/api/use-files';
import { useCreateTask } from '@/hooks/api/use-tasks';
import { useTaskProgress } from '@/hooks/api/use-task-progress';
import { useTaskOutput } from '@/hooks/api/use-task-output';
import { useRequireLogin } from '@/hooks/use-require-login';
import { getToolByHref } from '@/lib/tools/tool-metadata';
import { cn } from '@/lib/utils';

type PageSize = 'original' | 'a4' | 'letter';
type FitMode = 'fit' | 'fill' | 'stretch';

const ACCEPTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
];

export default function FromImagePage() {
  const t = useTranslations('PdfTool');
  const tShell = useTranslations('ToolShell');
  const tool = getToolByHref('/pdf/from-image')!;
  const [files, setFiles] = useState<SortableFile[]>([]);
  const [pageSize, setPageSize] = useState<PageSize>('a4');
  const [fit, setFit] = useState<FitMode>('fit');
  const [outputFilename, setOutputFilename] = useState('images.pdf');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  // 产物取回走 useTaskOutput:pending / error 由 hook 统一持有,
  // 不再每页手写一遍 fetch + try/finally。
  const output = useTaskOutput<File>();
  // reset 的身份稳定(hook 内是 useCallback([])),放进依赖数组不会让回调反复重建。
  const resetOutput = output.reset;
  const result = output.result;
  const [error, setError] = useState<string | null>(null);

  const { requireLogin } = useRequireLogin();
  const uploadFile = useUploadFile();
  const createTask = useCreateTask();

  const { data: progress } = useTaskProgress(taskId, {
    onCompleted: async outputFileId => {
      const { error: downloadError } = await output.download(
        outputFileId,
        blob => {
          return new File([blob], outputFilename, { type: 'application/pdf' });
        }
      );
      if (downloadError) setError(downloadError.message);
      setProcessing(false);
    },
    onFailed: err => {
      setError(err.message);
      setProcessing(false);
    },
  });

  const handleDrop = useCallback(
    (dropped: File[]) => {
      const images = dropped.filter(f => ACCEPTED_IMAGE_TYPES.includes(f.type));
      if (images.length === 0) return;

      const newFiles: SortableFile[] = images.map(file => ({
        id: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
      }));
      setFiles(prev => [...prev, ...newFiles]);
      resetOutput();
      setError(null);
    },
    [resetOutput]
  );

  const handleRemove = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleConvert = async () => {
    if (files.length < 1) return;

    if (requireLogin('/pdf/from-image')) return;

    setProcessing(true);
    setError(null);
    resetOutput();

    try {
      const uploaded = await Promise.all(
        files.map(f => uploadFile.mutateAsync(f.file))
      );
      const fileIds = uploaded.map((u: any) => u.id);

      const task = await createTask.mutateAsync({
        type: 'image_to_pdf',
        inputFileIds: fileIds,
        inputConfig: {
          pageSize,
          fit,
          order: fileIds,
          outputFilename,
        },
      });
      setTaskId(task.id);
    } catch (err) {
      setError((err as Error).message);
      setProcessing(false);
    }
  };

  const pageSizeOptions: { value: PageSize; label: string }[] = [
    { value: 'original', label: t('fromImage.pageSizeOriginal') },
    { value: 'a4', label: t('fromImage.pageSizeA4') },
    { value: 'letter', label: t('fromImage.pageSizeLetter') },
  ];

  const fitOptions: { value: FitMode; label: string }[] = [
    { value: 'fit', label: t('fromImage.fitFit') },
    { value: 'fill', label: t('fromImage.fitFill') },
    { value: 'stretch', label: t('fromImage.fitStretch') },
  ];

  const handleReset = () => {
    setFiles([]);
    resetOutput();
    setError(null);
    setTaskId(null);
    setProcessing(false);
  };

  const stage = result
    ? 'result'
    : processing
      ? 'processing'
      : files.length > 0
        ? 'configure'
        : 'upload';

  return (
    <ToolPageShell
      title={t('fromImage.title')}
      description={t('fromImage.description')}
      processing={tool.processing}
      retention={tool.retention}
      requiresLogin={tool.requiresLogin}
      recovery={tShell('catalogRecovery')}
      stage={stage}
    >
      <FileDropzone
        accept={{
          'image/png': ['.png'],
          'image/jpeg': ['.jpg', '.jpeg'],
          'image/webp': ['.webp'],
        }}
        maxSize={50 * 1024 * 1024}
        multiple
        onDrop={handleDrop}
        disabled={processing}
        hint="PNG / JPEG / WebP"
        processingLabel={tShell('trust.processing.server')}
      />

      {files.length > 0 && (
        <div className="space-y-6">
          <SortableFileList
            files={files}
            onReorder={setFiles}
            onRemove={handleRemove}
            disabled={processing}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                {t('fromImage.pageSize')}
              </label>
              <div className="flex flex-wrap gap-2">
                {pageSizeOptions.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPageSize(value)}
                    disabled={processing}
                    className={cn(
                      'px-3 h-9 text-sm font-mono border rounded-md transition-colors',
                      pageSize === value
                        ? 'border-accent text-foreground bg-accent/10'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                {t('fromImage.fit')}
              </label>
              <div className="flex flex-wrap gap-2">
                {fitOptions.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFit(value)}
                    disabled={processing}
                    className={cn(
                      'px-3 h-9 text-sm font-mono border rounded-md transition-colors',
                      fit === value
                        ? 'border-accent text-foreground bg-accent/10'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
              {t('fromImage.outputFilename')}
            </label>
            <input
              type="text"
              value={outputFilename}
              onChange={e => setOutputFilename(e.target.value)}
              disabled={processing}
              className="w-full h-9 px-3 text-sm font-mono bg-transparent border border-border rounded-md focus:border-accent focus:outline-none transition-colors disabled:opacity-50"
            />
          </div>

          <button
            type="button"
            onClick={handleConvert}
            disabled={processing || files.length < 1}
            className="w-full h-10 text-sm font-mono bg-foreground text-background rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {processing ? t('fromImage.processing') : t('fromImage.start')}
          </button>
        </div>
      )}

      {processing && progress && (
        <ProcessingProgress progress={progress.progress} stage="processing" />
      )}

      {error && (
        <FailureRecoveryPanel
          message={error}
          onRetry={handleConvert}
          onReset={handleReset}
        />
      )}

      {result && (
        <ResultPanel
          title={result.name}
          description={tShell('result.ready')}
          action={<DownloadButton file={result} />}
        />
      )}
    </ToolPageShell>
  );
}
