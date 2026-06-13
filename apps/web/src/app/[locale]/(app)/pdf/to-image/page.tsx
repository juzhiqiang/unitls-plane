'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { ProcessingProgress } from '@/components/tools/processing-progress';
import { DownloadButton } from '@/components/tools/download-button';
import { PdfPagePreviewImage } from '@/components/tools/pdf-page-preview-image';
import { ToolPageShell } from '@/components/tools/tool-page-shell';
import { FailureRecoveryPanel } from '@/components/tools/failure-recovery-panel';
import { ResultPanel } from '@/components/tools/result-panel';
import { useUploadFile } from '@/hooks/api/use-files';
import { useCreateTask } from '@/hooks/api/use-tasks';
import { useTaskProgress } from '@/hooks/api/use-task-progress';
import { authClient } from '@/lib/auth-client';
import { getToolByHref } from '@/lib/tools/tool-metadata';
import { cn } from '@/lib/utils';
interface PageThumbProps {
  pdf: any;
  pageNumber: number;
  selected: boolean;
  onToggle: (page: number) => void;
}

function PageThumb({ pdf, pageNumber, selected, onToggle }: PageThumbProps) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    import('@/lib/processing/pdf-client').then(({ renderPdfPage }) => {
      renderPdfPage(pdf, pageNumber, 0.25).then(c => {
        if (!cancelled) setCanvas(c);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, pageNumber]);

  return (
    <button
      type="button"
      onClick={() => onToggle(pageNumber)}
      className={cn(
        'relative border bg-muted/20 p-1 transition-colors text-left',
        selected
          ? 'border-l-2 border-l-accent border-t-border border-r-border border-b-border'
          : 'border-border hover:bg-muted/40'
      )}
    >
      <div className="w-full aspect-[3/4] flex items-center justify-center overflow-hidden">
        {canvas ? (
          <PdfPagePreviewImage
            canvas={canvas}
            alt={`Page ${pageNumber}`}
            className="w-full h-full object-contain"
          />
        ) : (
          <span className="text-[9px] font-mono text-muted-foreground">
            ...
          </span>
        )}
      </div>
      <p className="text-[10px] font-mono text-center text-muted-foreground mt-1 tabular-nums">
        {pageNumber}
      </p>
    </button>
  );
}

export default function ToImagePage() {
  const t = useTranslations('PdfTool');
  const tShell = useTranslations('ToolShell');
  const tool = getToolByHref('/pdf/to-image')!;
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [pdf, setPdf] = useState<any>(null);
  const [pageCount, setPageCount] = useState(0);
  const [format, setFormat] = useState<'png' | 'jpeg'>('png');
  const [dpi, setDpi] = useState(150);
  const [quality, setQuality] = useState(85);
  const [selectAll, setSelectAll] = useState(true);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [taskId, setTaskId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: session } = authClient.useSession();
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
        const ext = format === 'jpeg' ? 'jpg' : 'png';
        const baseName = file?.name.replace(/\.pdf$/i, '') ?? 'output';
        const outputName =
          pageCount === 1 ? `${baseName}.${ext}` : `${baseName}-images.zip`;
        const mimeType =
          pageCount === 1 ? `image/${format}` : 'application/zip';
        setResult(new File([blob], outputName, { type: mimeType }));
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
    setSelectedPages(new Set());
    setSelectAll(true);
    setResult(null);
    setError(null);
  }, []);

  const togglePage = (page: number) => {
    setSelectedPages(prev => {
      const next = new Set(prev);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
  };

  const handleConvert = async () => {
    if (!file) return;

    if (!session) {
      const next = encodeURIComponent('/pdf/to-image');
      router.push(`/login?next=${next}`);
      return;
    }

    setProcessing(true);
    setError(null);
    setResult(null);

    try {
      const uploaded = (await uploadFile.mutateAsync(file)) as any;

      const inputConfig: Record<string, unknown> = { format, dpi };
      if (format === 'jpeg') {
        inputConfig.quality = quality;
      }
      if (!selectAll && selectedPages.size > 0) {
        inputConfig.pages = Array.from(selectedPages)
          .sort((a, b) => a - b)
          .map(p => p - 1);
      }

      const task = await createTask.mutateAsync({
        type: 'pdf_to_image',
        inputFileIds: [uploaded.id],
        inputConfig,
      });
      setTaskId(task.id);
    } catch (err) {
      setError((err as Error).message);
      setProcessing(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setPdf(null);
    setPageCount(0);
    setSelectedPages(new Set());
    setSelectAll(true);
    setResult(null);
    setError(null);
    setTaskId(null);
    setProcessing(false);
  };

  const stage = result
    ? 'result'
    : processing
      ? 'processing'
      : file
        ? 'configure'
        : 'upload';

  return (
    <ToolPageShell
      title={t('toImage.title')}
      description={t('toImage.description')}
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
                {pageCount} {t('toImage.pages')}
              </p>
            </div>
            <button
              type="button"
              onClick={handleReset}
              className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('toImage.changeFile')}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                {t('toImage.format')}
              </label>
              <div className="flex gap-2">
                {(['png', 'jpeg'] as const).map(f => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFormat(f)}
                    disabled={processing}
                    className={cn(
                      'px-4 h-9 text-sm font-mono border rounded-md transition-colors',
                      format === f
                        ? 'border-accent text-foreground bg-accent/10'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                {t('toImage.dpi')}
              </label>
              <input
                type="number"
                min={72}
                max={600}
                step={1}
                value={dpi}
                onChange={e => setDpi(Number(e.target.value))}
                disabled={processing}
                className="w-24 h-9 px-3 text-sm font-mono bg-transparent border border-border rounded-md focus:border-accent focus:outline-none tabular-nums disabled:opacity-50"
              />
            </div>

            {format === 'jpeg' && (
              <div className="space-y-2">
                <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                  {t('toImage.quality')}
                </label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={quality}
                  onChange={e => setQuality(Number(e.target.value))}
                  disabled={processing}
                  className="w-24 h-9 px-3 text-sm font-mono bg-transparent border border-border rounded-md focus:border-accent focus:outline-none tabular-nums disabled:opacity-50"
                />
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => setSelectAll(true)}
                disabled={processing}
                className={cn(
                  'text-xs font-mono transition-colors',
                  selectAll
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t('toImage.allPages')}
              </button>
              <button
                type="button"
                onClick={() => setSelectAll(false)}
                disabled={processing}
                className={cn(
                  'text-xs font-mono transition-colors',
                  !selectAll
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t('toImage.selectedPages')}
              </button>
            </div>

            {!selectAll && (
              <div>
                <p className="text-xs text-muted-foreground mb-3">
                  {t('toImage.selectPages')}
                </p>
                <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 gap-2">
                  {Array.from({ length: pageCount }, (_, i) => i + 1).map(
                    page => (
                      <PageThumb
                        key={page}
                        pdf={pdf}
                        pageNumber={page}
                        selected={selectedPages.has(page)}
                        onToggle={togglePage}
                      />
                    )
                  )}
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleConvert}
            disabled={processing || (!selectAll && selectedPages.size === 0)}
            className="w-full h-10 text-sm font-mono bg-foreground text-background rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {processing ? t('toImage.processing') : t('toImage.start')}
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
