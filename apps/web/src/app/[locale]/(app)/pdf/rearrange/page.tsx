'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { X } from 'lucide-react';
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
import { useTaskOutput } from '@/hooks/api/use-task-output';
import { useRequireLogin } from '@/hooks/use-require-login';
import { getToolByHref } from '@/lib/tools/tool-metadata';
import { cn } from '@/lib/utils';

interface SortablePageCardProps {
  pdf: any;
  pageIndex: number; // 0-based original page index
  orderIndex: number; // 1-based display position
  onDelete: (pageIndex: number) => void;
  disabled?: boolean;
}

function SortablePageCard({
  pdf,
  pageIndex,
  orderIndex,
  onDelete,
  disabled,
}: SortablePageCardProps) {
  const id = String(pageIndex);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  useEffect(() => {
    let cancelled = false;
    import('@/lib/processing/pdf-client').then(({ renderPdfPage }) => {
      renderPdfPage(pdf, pageIndex + 1, 0.3).then(c => {
        if (!cancelled) setCanvas(c);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, pageIndex]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative border border-border bg-muted/20 p-1 select-none',
        'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-50 shadow-lg z-10'
      )}
      {...attributes}
      {...listeners}
    >
      <button
        type="button"
        onPointerDown={e => e.stopPropagation()}
        onClick={e => {
          e.stopPropagation();
          onDelete(pageIndex);
        }}
        disabled={disabled}
        className={cn(
          'absolute top-1 right-1 z-10 h-5 w-5 flex items-center justify-center',
          'bg-background/90 border border-border rounded-sm',
          'text-muted-foreground hover:text-destructive hover:border-destructive',
          'opacity-0 group-hover:opacity-100 transition-opacity',
          'disabled:opacity-30 disabled:cursor-not-allowed'
        )}
        aria-label="Delete page"
      >
        <X className="h-3 w-3" strokeWidth={1.5} />
      </button>

      <div className="w-full aspect-[3/4] flex items-center justify-center overflow-hidden bg-background">
        {canvas ? (
          <PdfPagePreviewImage
            canvas={canvas}
            alt={`Page ${pageIndex + 1}`}
            className="w-full h-full object-contain pointer-events-none"
            draggable={false}
          />
        ) : (
          <span className="text-[9px] font-mono text-muted-foreground">
            ...
          </span>
        )}
      </div>
      <p className="text-[10px] font-mono text-center text-muted-foreground mt-1 tabular-nums">
        {orderIndex}
      </p>
    </div>
  );
}

export default function RearrangePage() {
  const t = useTranslations('PdfTool');
  const tShell = useTranslations('ToolShell');
  const tool = getToolByHref('/pdf/rearrange')!;
  const [file, setFile] = useState<File | null>(null);
  const [pdf, setPdf] = useState<any>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageOrder, setPageOrder] = useState<number[]>([]);
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const { data: progress } = useTaskProgress(taskId, {
    onCompleted: async outputFileId => {
      const { error: downloadError } = await output.download(
        outputFileId,
        blob => {
          const baseName = file?.name ?? 'output.pdf';
          const outputName = `rearranged-${baseName}`;
          return new File([blob], outputName, { type: 'application/pdf' });
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

  useEffect(() => {
    if (pageCount > 0) {
      setPageOrder(Array.from({ length: pageCount }, (_, i) => i));
    }
  }, [pageCount]);

  const handleDrop = useCallback(
    (files: File[]) => {
      const pdfFile = files.find(f => f.type === 'application/pdf');
      if (!pdfFile) return;
      setFile(pdfFile);
      setPdf(null);
      setPageCount(0);
      setPageOrder([]);
      resetOutput();
      setError(null);
    },
    [resetOutput]
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setPageOrder(prev => {
      const oldIdx = prev.indexOf(Number(active.id));
      const newIdx = prev.indexOf(Number(over.id));
      if (oldIdx === -1 || newIdx === -1) return prev;
      return arrayMove(prev, oldIdx, newIdx);
    });
  };

  const deletePage = (p: number) => {
    setPageOrder(prev => prev.filter(x => x !== p));
  };

  const handleReverse = () => {
    setPageOrder(prev => [...prev].reverse());
  };

  const handleReset = () => {
    setPageOrder(Array.from({ length: pageCount }, (_, i) => i));
  };

  const handleChangeFile = () => {
    setFile(null);
    setPdf(null);
    setPageCount(0);
    setPageOrder([]);
    resetOutput();
    setError(null);
    setTaskId(null);
  };

  const handleStart = async () => {
    if (!file || pageOrder.length === 0) return;

    if (requireLogin('/pdf/rearrange')) return;

    setProcessing(true);
    setError(null);
    resetOutput();

    try {
      const uploaded = (await uploadFile.mutateAsync(file)) as any;

      const task = await createTask.mutateAsync({
        type: 'pdf_rearrange',
        inputFileIds: [uploaded.id],
        inputConfig: { pageOrder },
      });
      setTaskId(task.id);
    } catch (err) {
      setError((err as Error).message);
      setProcessing(false);
    }
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
      title={t('rearrange.title')}
      description={t('rearrange.description')}
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
                {pageCount} {t('rearrange.pages')}
                <span className="mx-2 text-border">|</span>
                {t('rearrange.remaining')}: {pageOrder.length} / {pageCount}
              </p>
            </div>
            <button
              type="button"
              onClick={handleChangeFile}
              className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('rearrange.changeFile')}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReverse}
              disabled={processing || pageOrder.length === 0}
              className="px-3 h-8 text-xs font-mono border border-border rounded-md text-muted-foreground hover:text-foreground hover:border-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('rearrange.reverse')}
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={
                processing ||
                (pageOrder.length === pageCount &&
                  pageOrder.every((v, i) => v === i))
              }
              className="px-3 h-8 text-xs font-mono border border-border rounded-md text-muted-foreground hover:text-foreground hover:border-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('rearrange.reset')}
            </button>
          </div>

          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {t('rearrange.dragHint')}
            </p>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={pageOrder.map(p => String(p))}
                strategy={rectSortingStrategy}
              >
                <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-3">
                  {pageOrder.map((pageIdx, i) => (
                    <SortablePageCard
                      key={pageIdx}
                      pdf={pdf}
                      pageIndex={pageIdx}
                      orderIndex={i + 1}
                      onDelete={deletePage}
                      disabled={processing}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>

          <button
            type="button"
            onClick={handleStart}
            disabled={processing || pageOrder.length === 0}
            className="w-full h-10 text-sm font-mono bg-foreground text-background rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {processing ? t('rearrange.processing') : t('rearrange.start')}
          </button>
        </div>
      )}

      {processing && progress && (
        <ProcessingProgress progress={progress.progress} stage="processing" />
      )}

      {error && (
        <FailureRecoveryPanel
          message={error}
          onRetry={handleStart}
          onReset={handleChangeFile}
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
