'use client';

import { useState, useEffect, useCallback } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { ProcessingProgress } from '@/components/tools/processing-progress';
import { DownloadButton } from '@/components/tools/download-button';
import { ToolPageShell } from '@/components/tools/tool-page-shell';
import { FailureRecoveryPanel } from '@/components/tools/failure-recovery-panel';
import { ResultPanel } from '@/components/tools/result-panel';
import { useUploadFile } from '@/hooks/api/use-files';
import { useCreateTask } from '@/hooks/api/use-tasks';
import { useTaskProgress } from '@/hooks/api/use-task-progress';
import { useRequireLogin } from '@/hooks/use-require-login';
import { formatBytes } from '@/lib/format';
import { getToolByHref } from '@/lib/tools/tool-metadata';
import { cn } from '@/lib/utils';

type CompressLevel = 'light' | 'medium' | 'heavy';

export default function CompressPage() {
  const t = useTranslations('PdfTool');
  const tShell = useTranslations('ToolShell');
  const tUnits = useTranslations('Common.units');
  const locale = useLocale();
  const tool = getToolByHref('/pdf/compress')!;
  const [file, setFile] = useState<File | null>(null);
  const [pdf, setPdf] = useState<any>(null);
  const [pageCount, setPageCount] = useState(0);
  const [level, setLevel] = useState<CompressLevel>('medium');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [resultFile, setResultFile] = useState<File | null>(null);
  const [compressedSize, setCompressedSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { requireLogin } = useRequireLogin();
  const uploadFile = useUploadFile();
  const createTask = useCreateTask();

  const { data: progress } = useTaskProgress(taskId, {
    onCompleted: async outputFileId => {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/files/${outputFileId}/download`,
          { credentials: 'include' }
        );
        if (!response.ok) throw new Error('Download failed');
        const blob = await response.blob();
        const pdfBlob = new Blob([blob], { type: 'application/pdf' });
        const baseName = file?.name.replace(/\.pdf$/i, '') ?? 'output';
        setCompressedSize(pdfBlob.size);
        setResultFile(
          new File([pdfBlob], `${baseName}-compressed.pdf`, {
            type: 'application/pdf',
          })
        );
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setProcessing(false);
      }
    },
    onFailed: err => {
      setError(err.message);
      setProcessing(false);
    },
  });

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    import('@/lib/processing/pdf-client').then(({ loadPdf }) => {
      loadPdf(file).then(doc => {
        if (cancelled) return;
        setPdf(doc);
        setPageCount(doc.numPages);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [file]);

  const handleDrop = useCallback((files: File[]) => {
    const pdfFile = files.find(f => f.type === 'application/pdf');
    if (!pdfFile) return;
    setFile(pdfFile);
    setPdf(null);
    setPageCount(0);
    setResultFile(null);
    setCompressedSize(null);
    setError(null);
  }, []);

  const handleCompress = async () => {
    if (!file) return;

    if (requireLogin('/pdf/compress')) return;

    setProcessing(true);
    setError(null);
    setResultFile(null);
    setCompressedSize(null);

    try {
      const uploaded = (await uploadFile.mutateAsync(file)) as any;

      const task = await createTask.mutateAsync({
        type: 'pdf_compress',
        inputFileIds: [uploaded.id],
        inputConfig: { level },
      });
      setTaskId(task.id);
    } catch (err) {
      setError((err as Error).message);
      setProcessing(false);
    }
  };

  const levels: { value: CompressLevel; label: string; desc: string }[] = [
    {
      value: 'light',
      label: t('compress.levelLight'),
      desc: t('compress.levelLightDesc'),
    },
    {
      value: 'medium',
      label: t('compress.levelMedium'),
      desc: t('compress.levelMediumDesc'),
    },
    {
      value: 'heavy',
      label: t('compress.levelHeavy'),
      desc: t('compress.levelHeavyDesc'),
    },
  ];

  const showWarning = level === 'medium' || level === 'heavy';
  const originalSize = file?.size ?? 0;
  const savedPercent =
    compressedSize !== null && originalSize > 0
      ? ((1 - compressedSize / originalSize) * 100).toFixed(1)
      : null;

  const handleReset = () => {
    setFile(null);
    setPdf(null);
    setPageCount(0);
    setResultFile(null);
    setCompressedSize(null);
    setError(null);
    setTaskId(null);
    setProcessing(false);
  };

  const stage = resultFile
    ? 'result'
    : processing
      ? 'processing'
      : file
        ? 'configure'
        : 'upload';

  return (
    <ToolPageShell
      title={t('compress.title')}
      description={t('compress.description')}
      processing={tool.processing}
      retention={tool.retention}
      requiresLogin={tool.requiresLogin}
      recovery={tShell('catalogRecovery')}
      stage={stage}
    >
      {!file && (
        <FileDropzone
          accept={{ 'application/pdf': ['.pdf'] }}
          maxSize={50 * 1024 * 1024}
          onDrop={handleDrop}
          hint="PDF"
          processingLabel={tShell('trust.processing.server')}
        />
      )}

      {file && pdf && (
        <div className="space-y-6">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div>
              <p className="text-sm font-mono text-foreground">{file.name}</p>
              <p className="text-[10px] font-mono text-muted-foreground tabular-nums">
                {formatBytes(file.size, tUnits, locale)} · {pageCount}{' '}
                {t('compress.pages')}
              </p>
            </div>
            <button
              type="button"
              onClick={handleReset}
              className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('compress.changeFile')}
            </button>
          </div>

          <div className="space-y-3">
            <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block">
              {t('compress.level')}
            </label>
            <div className="space-y-2">
              {levels.map(({ value, label, desc }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setLevel(value)}
                  disabled={processing}
                  className={cn(
                    'w-full text-left p-4 border rounded-md transition-colors',
                    level === value
                      ? 'border-accent bg-accent/10'
                      : 'border-border hover:border-foreground/40'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        'text-sm font-mono',
                        level === value
                          ? 'text-foreground'
                          : 'text-muted-foreground'
                      )}
                    >
                      {label}
                    </span>
                    {level === value && (
                      <span className="text-[10px] font-mono text-accent">
                        ●
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{desc}</p>
                </button>
              ))}
            </div>
            {showWarning && (
              <p className="text-xs font-mono text-destructive/70">
                {t('compress.warning')}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={handleCompress}
            disabled={processing}
            className="w-full h-10 text-sm font-mono bg-foreground text-background rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {processing ? t('compress.processing') : t('compress.start')}
          </button>
        </div>
      )}

      {processing && progress && (
        <ProcessingProgress progress={progress.progress} stage="processing" />
      )}

      {error && (
        <FailureRecoveryPanel
          message={error}
          onRetry={handleCompress}
          onReset={handleReset}
        />
      )}

      {resultFile && compressedSize !== null && (
        <ResultPanel
          title={resultFile.name}
          description={tShell('result.ready')}
          meta={[
            {
              label: t('compress.originalSize'),
              value: formatBytes(originalSize, tUnits, locale),
            },
            {
              label: t('compress.compressedSize'),
              value: formatBytes(compressedSize, tUnits, locale),
            },
            { label: t('compress.saved'), value: `${savedPercent}%` },
          ]}
          action={<DownloadButton file={resultFile} />}
        />
      )}
    </ToolPageShell>
  );
}
