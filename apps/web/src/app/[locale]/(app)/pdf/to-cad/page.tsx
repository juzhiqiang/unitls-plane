'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  CAD_ERROR_CODES,
  PDF_TO_CAD_SCALE_MAX,
  PDF_TO_CAD_SCALE_MIN,
  pdfToCadConversionMetaSchema,
  type CadLayerMode,
  type CadOutputFormat,
  type CadUnit,
  type PdfToCadConversionMeta,
  type PdfToCadTaskConfigInput,
} from '@utils-plane/validators';
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
import { api } from '@/lib/api-client';
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

interface CadResult {
  file: File;
  meta: PdfToCadConversionMeta | null;
}

type CadErrorCode = (typeof CAD_ERROR_CODES)[number];

function isCadErrorCode(code: string | undefined): code is CadErrorCode {
  return !!code && (CAD_ERROR_CODES as readonly string[]).includes(code);
}

/** 任务进度落在哪个阶段:与处理器的 5→50 解析、50→80 OCR、80→90 写出、90→100 上传对应。 */
function stageForProgress(
  progress: number
): 'stageParse' | 'stageOcr' | 'stageWrite' | 'stageUpload' {
  if (progress < 50) return 'stageParse';
  if (progress < 80) return 'stageOcr';
  if (progress < 90) return 'stageWrite';
  return 'stageUpload';
}

const OPTION_BUTTON =
  'px-4 h-9 text-sm font-mono border rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40';
const OPTION_ACTIVE = 'border-accent text-foreground bg-accent/10';
const OPTION_IDLE = 'border-border text-muted-foreground hover:text-foreground';
const LABEL =
  'text-[10px] font-mono text-muted-foreground uppercase tracking-wider';

export default function ToCadPage() {
  const t = useTranslations('PdfTool');
  const tShell = useTranslations('ToolShell');
  const tool = getToolByHref('/pdf/to-cad')!;
  const [file, setFile] = useState<File | null>(null);
  const [pdf, setPdf] = useState<any>(null);
  const [pageCount, setPageCount] = useState(0);
  const [format, setFormat] = useState<CadOutputFormat>('dxf');
  const [unit, setUnit] = useState<CadUnit>('mm');
  const [scale, setScale] = useState(1);
  const [layerMode, setLayerMode] = useState<CadLayerMode>('source');
  const [ocr, setOcr] = useState(false);
  const [includeRasterUnderlay, setIncludeRasterUnderlay] = useState(false);
  const [selectAll, setSelectAll] = useState(true);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [taskId, setTaskId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const output = useTaskOutput<CadResult>();
  const resetOutput = output.reset;
  const result = output.result;
  const [error, setError] = useState<{
    message: string;
    code?: string;
  } | null>(null);

  const { requireLogin } = useRequireLogin();
  const uploadFile = useUploadFile();
  const createTask = useCreateTask();

  const { data: progress } = useTaskProgress(taskId, {
    onCompleted: async outputFileId => {
      // 状态轮询只带 outputFileId;实体/OCR 统计与降级原因在任务详情的 outputMeta 里。
      let meta: PdfToCadConversionMeta | null = null;
      if (taskId) {
        const { data } = await api.GET('/tasks/{id}', {
          params: { path: { id: taskId } },
        });
        const parsed = pdfToCadConversionMetaSchema.safeParse(
          (data as { outputMeta?: unknown } | undefined)?.outputMeta
        );
        if (parsed.success) meta = parsed.data;
      }
      const baseName = file?.name.replace(/\.pdf$/i, '') ?? 'drawing';
      const { error: downloadError } = await output.download(
        outputFileId,
        blob => {
          const archived = meta?.underlay ?? blob.type === 'application/zip';
          return {
            file: new File([blob], `${baseName}.${archived ? 'zip' : 'dxf'}`, {
              type: archived ? 'application/zip' : 'application/dxf',
            }),
            meta,
          };
        }
      );
      if (downloadError) setError({ message: downloadError.message });
      setProcessing(false);
    },
    onFailed: err => {
      setError({
        message: isCadErrorCode(err.code)
          ? t(`toCad.errors.${err.code}`)
          : err.message || t('toCad.errorFallback'),
        code: err.code,
      });
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

  const handleDrop = useCallback(
    (files: File[]) => {
      const pdfFile = files.find(f => f.type === 'application/pdf');
      if (!pdfFile) return;
      setFile(pdfFile);
      setPdf(null);
      setPageCount(0);
      setSelectedPages(new Set());
      setSelectAll(true);
      resetOutput();
      setError(null);
    },
    [resetOutput]
  );

  const togglePage = (page: number) => {
    setSelectedPages(prev => {
      const next = new Set(prev);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
  };

  const scaleValid =
    Number.isFinite(scale) &&
    scale >= PDF_TO_CAD_SCALE_MIN &&
    scale <= PDF_TO_CAD_SCALE_MAX;
  // DWG 首版未支持:界面上可见但禁用,这里再兜一层,保证永远提交不出 DWG 任务。
  const canSubmit =
    !processing &&
    format === 'dxf' &&
    scaleValid &&
    (selectAll || selectedPages.size > 0);

  const handleConvert = async () => {
    if (!file || !canSubmit) return;

    if (requireLogin('/pdf/to-cad')) return;

    setProcessing(true);
    setError(null);
    resetOutput();

    try {
      const uploaded = (await uploadFile.mutateAsync(file)) as any;

      const inputConfig: PdfToCadTaskConfigInput = {
        format,
        unit,
        scale,
        ocr,
        includeRasterUnderlay,
        layerMode,
      };
      if (!selectAll && selectedPages.size > 0) {
        inputConfig.pages = Array.from(selectedPages)
          .sort((a, b) => a - b)
          .map(p => p - 1);
      }

      const task = await createTask.mutateAsync({
        type: 'pdf_to_cad',
        inputFileIds: [uploaded.id],
        inputConfig,
      });
      setTaskId(task.id);
    } catch (err) {
      setError({ message: (err as Error).message });
      setProcessing(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setPdf(null);
    setPageCount(0);
    setSelectedPages(new Set());
    setSelectAll(true);
    resetOutput();
    setError(null);
    setTaskId(null);
    setProcessing(false);
  };

  const resultMeta = useMemo(() => {
    const meta = result?.meta;
    if (!meta) return [];
    const { pdf, ocr: ocrCount, inferred } = meta.entityCountBySource;
    return [
      { label: t('toCad.statPages'), value: String(meta.pageCount) },
      { label: t('toCad.statEntities'), value: String(meta.entityCount) },
      {
        label: t('toCad.statSources'),
        value: `${pdf} / ${ocrCount} / ${inferred}`,
      },
      { label: t('toCad.statOcrText'), value: String(meta.ocrTextCount) },
      {
        label: t('toCad.statUnit'),
        value: `${meta.unit} × ${meta.scale}`,
      },
    ];
  }, [result, t]);

  const stage = result
    ? 'result'
    : processing
      ? 'processing'
      : file
        ? 'configure'
        : 'upload';

  return (
    <ToolPageShell
      title={t('toCad.title')}
      description={t('toCad.description')}
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
                {pageCount} {t('toCad.pages')}
              </p>
            </div>
            <button
              type="button"
              onClick={handleReset}
              className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('toCad.changeFile')}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className={LABEL}>{t('toCad.format')}</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFormat('dxf')}
                  disabled={processing}
                  className={cn(
                    OPTION_BUTTON,
                    format === 'dxf' ? OPTION_ACTIVE : OPTION_IDLE
                  )}
                >
                  {t('toCad.formatDxf')}
                </button>
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  title={t('toCad.dwgUnavailable')}
                  className={cn(OPTION_BUTTON, OPTION_IDLE)}
                >
                  {t('toCad.formatDwg')}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('toCad.dwgUnavailable')}
              </p>
            </div>

            <div className="space-y-2">
              <label className={LABEL}>{t('toCad.unit')}</label>
              <div className="flex gap-2">
                {(['mm', 'inch'] as const).map(value => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setUnit(value)}
                    disabled={processing}
                    className={cn(
                      OPTION_BUTTON,
                      unit === value ? OPTION_ACTIVE : OPTION_IDLE
                    )}
                  >
                    {value === 'mm' ? t('toCad.unitMm') : t('toCad.unitInch')}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className={LABEL} htmlFor="cad-scale">
                {t('toCad.scale')}
              </label>
              <input
                id="cad-scale"
                type="number"
                min={PDF_TO_CAD_SCALE_MIN}
                max={PDF_TO_CAD_SCALE_MAX}
                step="any"
                value={scale}
                onChange={e => setScale(Number(e.target.value))}
                disabled={processing}
                className={cn(
                  'w-32 h-9 px-3 text-sm font-mono bg-transparent border rounded-md focus:border-accent focus:outline-none tabular-nums disabled:opacity-50',
                  scaleValid ? 'border-border' : 'border-destructive'
                )}
              />
              <p className="text-xs text-muted-foreground">
                {t('toCad.scaleHint')}
              </p>
            </div>

            <div className="space-y-2">
              <label className={LABEL}>{t('toCad.layerMode')}</label>
              <div className="flex gap-2">
                {(['source', 'semantic'] as const).map(value => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setLayerMode(value)}
                    disabled={processing}
                    className={cn(
                      OPTION_BUTTON,
                      layerMode === value ? OPTION_ACTIVE : OPTION_IDLE
                    )}
                  >
                    {value === 'source'
                      ? t('toCad.layerSource')
                      : t('toCad.layerSemantic')}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {t('toCad.layerModeHint')}
              </p>
            </div>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={ocr}
                onChange={e => setOcr(e.target.checked)}
                disabled={processing}
                className="mt-1 h-4 w-4 rounded-none border border-border bg-transparent checked:bg-accent checked:border-accent"
              />
              <span>
                <span className="block text-sm font-mono text-foreground">
                  {t('toCad.ocr')}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t('toCad.ocrHint')}
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={includeRasterUnderlay}
                onChange={e => setIncludeRasterUnderlay(e.target.checked)}
                disabled={processing}
                className="mt-1 h-4 w-4 rounded-none border border-border bg-transparent checked:bg-accent checked:border-accent"
              />
              <span>
                <span className="block text-sm font-mono text-foreground">
                  {t('toCad.underlay')}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t('toCad.underlayHint')}
                </span>
              </span>
            </label>
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
                {t('toCad.allPages')}
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
                {t('toCad.selectedPages')}
              </button>
            </div>

            {!selectAll && (
              <div>
                <p className="text-xs text-muted-foreground mb-3">
                  {t('toCad.selectPages')}
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
            disabled={!canSubmit}
            className="w-full h-10 text-sm font-mono bg-foreground text-background rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {processing ? t('toCad.processing') : t('toCad.start')}
          </button>
        </div>
      )}

      {processing && progress && (
        <ProcessingProgress
          progress={progress.progress}
          label={t(`toCad.${stageForProgress(progress.progress)}`)}
        />
      )}

      {error && (
        <FailureRecoveryPanel
          message={error.message}
          errorCode={error.code}
          onRetry={handleConvert}
          onReset={handleReset}
        />
      )}

      {result && (
        <ResultPanel
          title={result.file.name}
          description={
            result.meta?.underlay
              ? t('toCad.resultZipHint')
              : t('toCad.resultReady')
          }
          meta={resultMeta}
          preview={
            result.meta && result.meta.degradations.length > 0 ? (
              <div className="rounded-md border border-border bg-muted/20 p-3">
                <p className={LABEL}>{t('toCad.degradationsTitle')}</p>
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {result.meta.degradations.map((item, index) => (
                    <li
                      key={`${item.code}-${item.page ?? 0}-${index}`}
                      className="flex flex-wrap gap-x-2"
                    >
                      {item.page !== undefined && (
                        <span className="font-mono text-foreground">
                          {t('toCad.degradationPage', { page: item.page })}
                        </span>
                      )}
                      <span>{t(`toCad.degradations.${item.code}`)}</span>
                      {item.count !== undefined && item.count > 1 && (
                        <span className="font-mono">
                          {t('toCad.degradationCount', { count: item.count })}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : undefined
          }
          action={<DownloadButton file={result.file} />}
        />
      )}
    </ToolPageShell>
  );
}
