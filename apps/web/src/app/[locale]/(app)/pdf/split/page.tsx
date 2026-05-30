'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import * as Tabs from '@radix-ui/react-tabs';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { ProcessingProgress } from '@/components/tools/processing-progress';
import { DownloadButton } from '@/components/tools/download-button';
import { PdfPagePreviewImage } from '@/components/tools/pdf-page-preview-image';
import { ZipDownloadButton } from '@/components/tools/zip-download-button';
import { loadPdf, renderPdfPage } from '@/lib/processing/pdf-client';
import { useUploadFile } from '@/hooks/api/use-files';
import { useCreateTask } from '@/hooks/api/use-tasks';
import { useTaskProgress } from '@/hooks/api/use-task-progress';
import { authClient } from '@/lib/auth-client';
import { cn } from '@/lib/utils';
import type { PDFDocumentProxy } from 'pdfjs-dist';

type SplitMode = 'ranges' | 'pages' | 'every';

interface PageThumbProps {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  selected: boolean;
  onToggle: (page: number) => void;
}

function PageThumb({ pdf, pageNumber, selected, onToggle }: PageThumbProps) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    renderPdfPage(pdf, pageNumber, 0.25).then((c) => {
      if (!cancelled) setCanvas(c);
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
      <p className="text-[10px] font-mono text-center text-muted-foreground mt-1 tabular-nums">
        {pageNumber}
      </p>
    </button>
  );
}

export default function SplitPage() {
  const t = useTranslations('PdfTool');
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [mode, setMode] = useState<SplitMode>('ranges');
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(1);
  const [everyN, setEveryN] = useState(5);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<File[]>([]);
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
        const name = `split-${Date.now()}.pdf`;
        setResults([new File([blob], name, { type: 'application/pdf' })]);
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

    loadPdf(file).then((doc) => {
      if (cancelled) return;
      setPdf(doc);
      setPageCount(doc.numPages);
      setRangeEnd(doc.numPages);
    });

    return () => { cancelled = true; };
  }, [file]);

  const handleDrop = useCallback((files: File[]) => {
    const pdfFile = files.find((f) => f.type === 'application/pdf');
    if (!pdfFile) return;
    setFile(pdfFile);
    setPdf(null);
    setPageCount(0);
    setSelectedPages(new Set());
    setResults([]);
    setError(null);
  }, []);

  const togglePage = (page: number) => {
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
  };

  const getInputConfig = () => {
    switch (mode) {
      case 'ranges':
        return { mode: 'ranges', ranges: [{ start: rangeStart, end: rangeEnd }] };
      case 'pages':
        return { mode: 'pages', pages: Array.from(selectedPages).sort((a, b) => a - b) };
      case 'every':
        return { mode: 'every', everyN };
    }
  };

  const canSplit = () => {
    if (!file || processing) return false;
    switch (mode) {
      case 'ranges':
        return rangeStart >= 1 && rangeEnd <= pageCount && rangeStart <= rangeEnd;
      case 'pages':
        return selectedPages.size > 0;
      case 'every':
        return everyN >= 1 && everyN <= pageCount;
    }
  };

  const handleSplit = async () => {
    if (!file || !canSplit()) return;

    if (!session) {
      const next = encodeURIComponent('/pdf/split');
      router.push(`/login?next=${next}`);
      return;
    }

    setProcessing(true);
    setError(null);
    setResults([]);

    try {
      const uploaded = (await uploadFile.mutateAsync(file)) as any;
      const task = await createTask.mutateAsync({
        type: 'pdf_split',
        inputFileIds: [uploaded.id],
        inputConfig: getInputConfig(),
      });
      setTaskId(task.id);
    } catch (err) {
      setError((err as Error).message);
      setProcessing(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-lg font-medium">{t('split.title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t('split.description')}
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
                {pageCount} {t('split.pages')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setFile(null); setPdf(null); }}
              className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('split.changeFile')}
            </button>
          </div>

          <Tabs.Root value={mode} onValueChange={(v) => setMode(v as SplitMode)}>
            <Tabs.List className="flex gap-6 border-b border-border">
              {(['ranges', 'pages', 'every'] as const).map((tab) => (
                <Tabs.Trigger
                  key={tab}
                  value={tab}
                  className={cn(
                    'pb-2 text-xs font-mono uppercase tracking-wider transition-colors relative',
                    'text-muted-foreground hover:text-foreground',
                    'data-[state=active]:text-foreground',
                    'after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px',
                    'after:bg-transparent data-[state=active]:after:bg-accent',
                  )}
                >
                  {t(`split.modes.${tab}`)}
                </Tabs.Trigger>
              ))}
            </Tabs.List>

            <Tabs.Content value="ranges" className="pt-6 space-y-4">
              <div className="flex items-center gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                    {t('split.from')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={pageCount}
                    value={rangeStart}
                    onChange={(e) => setRangeStart(Number(e.target.value))}
                    className="w-20 h-9 px-3 text-sm font-mono bg-transparent border border-border rounded-md focus:border-accent focus:outline-none tabular-nums"
                  />
                </div>
                <span className="text-muted-foreground mt-5">—</span>
                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                    {t('split.to')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={pageCount}
                    value={rangeEnd}
                    onChange={(e) => setRangeEnd(Number(e.target.value))}
                    className="w-20 h-9 px-3 text-sm font-mono bg-transparent border border-border rounded-md focus:border-accent focus:outline-none tabular-nums"
                  />
                </div>
              </div>
            </Tabs.Content>

            <Tabs.Content value="pages" className="pt-6">
              <p className="text-xs text-muted-foreground mb-4">
                {t('split.selectPages')}
              </p>
              <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 gap-2">
                {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => (
                  <PageThumb
                    key={page}
                    pdf={pdf}
                    pageNumber={page}
                    selected={selectedPages.has(page)}
                    onToggle={togglePage}
                  />
                ))}
              </div>
            </Tabs.Content>

            <Tabs.Content value="every" className="pt-6 space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                  {t('split.everyNPages')}
                </label>
                <input
                  type="number"
                  min={1}
                  max={pageCount}
                  value={everyN}
                  onChange={(e) => setEveryN(Number(e.target.value))}
                  className="w-20 h-9 px-3 text-sm font-mono bg-transparent border border-border rounded-md focus:border-accent focus:outline-none tabular-nums"
                />
              </div>
              <p className="text-xs font-mono text-muted-foreground tabular-nums">
                → {Math.ceil(pageCount / everyN)} {t('split.outputFiles')}
              </p>
            </Tabs.Content>
          </Tabs.Root>

          <button
            type="button"
            onClick={handleSplit}
            disabled={!canSplit()}
            className="w-full h-10 text-sm font-mono bg-foreground text-background rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {processing ? t('split.processing') : t('split.start')}
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

      {results.length > 0 && (
        <div className="flex justify-end">
          {results.length === 1 ? (
            <DownloadButton file={results[0]!} />
          ) : (
            <ZipDownloadButton files={results} zipName="split-pages.zip" />
          )}
        </div>
      )}
    </div>
  );
}
