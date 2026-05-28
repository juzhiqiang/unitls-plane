'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { ProcessingProgress } from '@/components/tools/processing-progress';
import { DownloadButton } from '@/components/tools/download-button';
import { useUploadFile } from '@/hooks/api/use-files';
import { useCreateTask } from '@/hooks/api/use-tasks';
import { useTaskProgress } from '@/hooks/api/use-task-progress';
import { authClient } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

type CompressLevel = 'light' | 'medium' | 'heavy';

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) {
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }
  return (n / 1024).toFixed(2) + ' KB';
}

export default function CompressPage() {
  const t = useTranslations('PdfTool');
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [pdf, setPdf] = useState<any>(null);
  const [pageCount, setPageCount] = useState(0);
  const [level, setLevel] = useState<CompressLevel>('medium');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [resultFile, setResultFile] = useState<File | null>(null);
  const [compressedSize, setCompressedSize] = useState<number | null>(null);
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
        const pdfBlob = new Blob([blob], { type: 'application/pdf' });
        const baseName = file?.name.replace(/\.pdf$/i, '') ?? 'output';
        setCompressedSize(pdfBlob.size);
        setResultFile(
          new File([pdfBlob], `${baseName}-compressed.pdf`, {
            type: 'application/pdf',
          }),
        );
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

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    import('@/lib/processing/pdf-client').then(({ loadPdf }) => {
      loadPdf(file).then((doc) => {
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
    const pdfFile = files.find((f) => f.type === 'application/pdf');
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

    if (!session) {
      const next = encodeURIComponent('/pdf/compress');
      router.push(`/login?next=${next}`);
      return;
    }

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

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-lg font-medium">{t('compress.title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t('compress.description')}
        </p>
      </div>

      {!file && (
        <FileDropzone
          accept={{ 'application/pdf': ['.pdf'] }}
          maxSize={50 * 1024 * 1024}
          onDrop={handleDrop}
          hint="PDF"
        />
      )}

      {file && pdf && (
        <div className="space-y-6">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div>
              <p className="text-sm font-mono text-foreground">{file.name}</p>
              <p className="text-[10px] font-mono text-muted-foreground tabular-nums">
                {formatBytes(file.size)} · {pageCount} {t('compress.pages')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setFile(null);
                setPdf(null);
                setResultFile(null);
                setCompressedSize(null);
              }}
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
                      : 'border-border hover:border-foreground/40',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        'text-sm font-mono',
                        level === value
                          ? 'text-foreground'
                          : 'text-muted-foreground',
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
        <ProcessingProgress progress={progress.progress} />
      )}

      {error && (
        <div className="text-xs font-mono text-destructive p-3 border border-destructive/30 rounded-md">
          {error}
          <button
            type="button"
            onClick={() => {
              setError(null);
              setTaskId(null);
            }}
            className="ml-3 underline hover:no-underline"
          >
            {t('retry')}
          </button>
        </div>
      )}

      {resultFile && compressedSize !== null && (
        <div className="space-y-4">
          <div className="border border-border rounded-md p-4 space-y-3">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                  {t('compress.originalSize')}
                </p>
                <p className="text-sm font-mono text-foreground mt-1 tabular-nums">
                  {formatBytes(originalSize)}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                  {t('compress.compressedSize')}
                </p>
                <p className="text-sm font-mono text-foreground mt-1 tabular-nums">
                  {formatBytes(compressedSize)}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                  {t('compress.saved')}
                </p>
                <p className="text-sm font-mono text-accent mt-1 tabular-nums">
                  {savedPercent}%
                </p>
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <DownloadButton file={resultFile} />
          </div>
        </div>
      )}
    </div>
  );
}
