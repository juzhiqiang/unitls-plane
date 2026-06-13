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

type Angle = 90 | 180 | 270;

interface PageThumbProps {
  pdf: any;
  pageNumber: number;
  selected: boolean;
  angle: Angle;
  onToggle: (page: number) => void;
}

function PageThumb({ pdf, pageNumber, selected, angle, onToggle }: PageThumbProps) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    import('@/lib/processing/pdf-client').then(({ renderPdfPage }) => {
      renderPdfPage(pdf, pageNumber, 0.25).then((c) => {
        if (!cancelled) setCanvas(c);
      });
    });
    return () => { cancelled = true; };
  }, [pdf, pageNumber]);

  return (
    <button
      type="button"
      onClick={() => onToggle(pageNumber)}
      className={cn(
        'relative border bg-muted/20 p-1 transition-colors text-left',
        selected
          ? 'border-l-2 border-l-accent border-t-border border-r-border border-b-border'
          : 'border-border hover:bg-muted/40',
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
          <span className="text-[9px] font-mono text-muted-foreground">...</span>
        )}
      </div>
      <p
        className="text-[10px] font-mono text-center text-muted-foreground mt-1 tabular-nums transition-transform"
        style={selected ? { transform: `rotate(${angle}deg)` } : undefined}
      >
        {pageNumber}
      </p>
    </button>
  );
}

export default function RotatePage() {
  const t = useTranslations('PdfTool');
  const tShell = useTranslations('ToolShell');
  const tool = getToolByHref('/pdf/rotate')!;
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [pdf, setPdf] = useState<any>(null);
  const [pageCount, setPageCount] = useState(0);
  const [angle, setAngle] = useState<Angle>(90);
  const [selectAll, setSelectAll] = useState(false);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
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
        const baseName = file?.name.replace(/\.pdf$/i, '') ?? 'output';
        const outputName = `${baseName}-rotated.pdf`;
        setResult(new File([blob], outputName, { type: 'application/pdf' }));
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

    return () => { cancelled = true; };
  }, [file]);

  // When switching to "All pages" tab, auto-select every page so submission stays valid.
  useEffect(() => {
    if (selectAll && pageCount > 0) {
      setSelectedPages(new Set(Array.from({ length: pageCount }, (_, i) => i + 1)));
    }
  }, [selectAll, pageCount]);

  const handleDrop = useCallback((files: File[]) => {
    const pdfFile = files.find((f) => f.type === 'application/pdf');
    if (!pdfFile) return;
    setFile(pdfFile);
    setPdf(null);
    setPageCount(0);
    setSelectedPages(new Set());
    setSelectAll(false);
    setResult(null);
    setError(null);
  }, []);

  const togglePage = (page: number) => {
    // Clicking a page implicitly switches to manual selection mode.
    if (selectAll) setSelectAll(false);
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
  };

  const handleRotate = async () => {
    if (!file) return;

    if (!session) {
      const next = encodeURIComponent('/pdf/rotate');
      router.push(`/login?next=${next}`);
      return;
    }

    if (selectedPages.size === 0) return;

    setProcessing(true);
    setError(null);
    setResult(null);

    try {
      const uploaded = (await uploadFile.mutateAsync(file)) as any;

      const inputConfig: Record<string, unknown> = {
        angle,
        pages: Array.from(selectedPages)
          .sort((a, b) => a - b)
          .map((p) => p - 1),
      };

      const task = await createTask.mutateAsync({
        type: 'pdf_rotate',
        inputFileIds: [uploaded.id],
        inputConfig,
      });
      setTaskId(task.id);
    } catch (err) {
      setError((err as Error).message);
      setProcessing(false);
    }
  };

  const angleOptions: Angle[] = [90, 180, 270];

  const handleReset = () => {
    setFile(null);
    setPdf(null);
    setPageCount(0);
    setResult(null);
    setSelectedPages(new Set());
    setSelectAll(false);
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
      title={t('rotate.title')}
      description={t('rotate.description')}
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
                {pageCount} {t('rotate.pages')}
              </p>
            </div>
            <button
              type="button"
              onClick={handleReset}
              className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('rotate.changeFile')}
            </button>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
              {t('rotate.angle')}
            </label>
            <div className="flex gap-2">
              {angleOptions.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAngle(a)}
                  disabled={processing}
                  className={cn(
                    'px-4 h-9 text-sm font-mono border rounded-md transition-colors',
                    angle === a
                      ? 'border-accent text-foreground bg-accent/10'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {a === 90
                    ? t('rotate.angle90')
                    : a === 180
                      ? t('rotate.angle180')
                      : t('rotate.angle270')}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex gap-4 border-b border-border">
              {[true, false].map((all) => (
                <button
                  key={String(all)}
                  type="button"
                  onClick={() => setSelectAll(all)}
                  disabled={processing}
                  className={cn(
                    'text-xs font-mono pb-2 transition-colors border-b-[1.5px] -mb-px',
                    selectAll === all
                      ? 'border-foreground text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {all ? t('rotate.allPages') : t('rotate.selectedPages')}
                </button>
              ))}
            </div>

            <div>
              <p className="text-xs text-muted-foreground mb-3">
                {t('rotate.selectPages')}
              </p>
              <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 gap-2">
                {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => (
                  <PageThumb
                    key={page}
                    pdf={pdf}
                    pageNumber={page}
                    selected={selectedPages.has(page)}
                    angle={angle}
                    onToggle={togglePage}
                  />
                ))}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleRotate}
            disabled={processing || selectedPages.size === 0}
            className="w-full h-10 text-sm font-mono bg-foreground text-background rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {processing ? t('rotate.processing') : t('rotate.start')}
          </button>
        </div>
      )}

      {processing && progress && (
        <ProcessingProgress progress={progress.progress} stage="processing" />
      )}

      {error && (
        <FailureRecoveryPanel
          message={error}
          onRetry={handleRotate}
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
