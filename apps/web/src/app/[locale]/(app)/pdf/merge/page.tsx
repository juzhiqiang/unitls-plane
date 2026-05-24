'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { SortableFileList, type SortableFile } from '@/components/tools/sortable-file-list';
import { ProcessingProgress } from '@/components/tools/processing-progress';
import { DownloadButton } from '@/components/tools/download-button';
import { useUploadFile } from '@/hooks/api/use-files';
import { useCreateTask } from '@/hooks/api/use-tasks';
import { useTaskProgress } from '@/hooks/api/use-task-progress';
import { authClient } from '@/lib/auth-client';

export default function MergePage() {
  const t = useTranslations('PdfTool');
  const router = useRouter();
  const [files, setFiles] = useState<SortableFile[]>([]);
  const [outputFilename, setOutputFilename] = useState('merged.pdf');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: session } = authClient.useSession();
  const uploadFile = useUploadFile();
  const createTask = useCreateTask();

  const { data: progress } = useTaskProgress(taskId, {
    onCompleted: async (outputFileId) => {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/files/${outputFileId}/download`,
          { credentials: 'include' },
        );
        if (!response.ok) throw new Error('Download failed');
        const blob = await response.blob();
        setResult(new File([blob], outputFilename, { type: 'application/pdf' }));
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setProcessing(false);
      }
    },
    onFailed: (err) => {
      setError(err.message);
      setProcessing(false);
    },
  });

  const handleDrop = useCallback((dropped: File[]) => {
    const pdfs = dropped.filter((f) => f.type === 'application/pdf');
    if (pdfs.length === 0) return;

    const newFiles: SortableFile[] = pdfs.map((file) => ({
      id: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
    }));
    setFiles((prev) => [...prev, ...newFiles]);
    setResult(null);
    setError(null);
  }, []);

  const handleRemove = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleMerge = async () => {
    if (files.length < 2) return;

    if (!session) {
      const next = encodeURIComponent('/pdf/merge');
      router.push(`/login?next=${next}`);
      return;
    }

    setProcessing(true);
    setError(null);
    setResult(null);

    try {
      const uploaded = await Promise.all(
        files.map((f) => uploadFile.mutateAsync(f.file)),
      );
      const fileIds = uploaded.map((u: any) => u.id);

      const task = await createTask.mutateAsync({
        type: 'pdf_merge',
        inputFileIds: fileIds,
        inputConfig: { outputFilename, order: fileIds },
      });
      setTaskId(task.id);
    } catch (err) {
      setError((err as Error).message);
      setProcessing(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-lg font-medium">{t('merge.title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t('merge.description')}
        </p>
      </div>

      <FileDropzone
        accept={{ 'application/pdf': ['.pdf'] }}
        maxSize={50 * 1024 * 1024}
        multiple
        onDrop={handleDrop}
        disabled={processing}
        hint="PDF"
      />

      {files.length > 0 && (
        <div className="space-y-6">
          <SortableFileList
            files={files}
            onReorder={setFiles}
            onRemove={handleRemove}
            disabled={processing}
          />

          <div className="space-y-2">
            <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
              {t('merge.outputFilename')}
            </label>
            <input
              type="text"
              value={outputFilename}
              onChange={(e) => setOutputFilename(e.target.value)}
              disabled={processing}
              className="w-full h-9 px-3 text-sm font-mono bg-transparent border border-border rounded-md focus:border-accent focus:outline-none transition-colors disabled:opacity-50"
            />
          </div>

          <button
            type="button"
            onClick={handleMerge}
            disabled={processing || files.length < 2}
            className="w-full h-10 text-sm font-mono bg-foreground text-background rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {processing ? t('merge.processing') : t('merge.start')}
          </button>
        </div>
      )}

      {processing && progress && (
        <ProcessingProgress progress={progress.progress} />
      )}

      {error && (
        <div className="text-xs font-mono text-destructive p-3 border border-destructive/30 rounded-md">
          {error}
          <button
            type="button"
            onClick={() => { setError(null); setTaskId(null); }}
            className="ml-3 underline hover:no-underline"
          >
            {t('retry')}
          </button>
        </div>
      )}

      {result && (
        <div className="flex justify-end">
          <DownloadButton file={result} />
        </div>
      )}
    </div>
  );
}
