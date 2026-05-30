'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { ProcessingProgress } from '@/components/tools/processing-progress';
import { DownloadButton } from '@/components/tools/download-button';
import { PdfPagePreviewImage } from '@/components/tools/pdf-page-preview-image';
import { useUploadFile } from '@/hooks/api/use-files';
import { useCreateTask } from '@/hooks/api/use-tasks';
import { useTaskProgress } from '@/hooks/api/use-task-progress';
import { authClient } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

type WatermarkColor = { r: number; g: number; b: number };
type WatermarkPosition = 'center' | 'diagonal';

const COLOR_PRESETS: { key: 'gray' | 'red' | 'blue'; value: WatermarkColor }[] = [
  { key: 'gray', value: { r: 0.5, g: 0.5, b: 0.5 } },
  { key: 'red', value: { r: 0.8, g: 0.2, b: 0.2 } },
  { key: 'blue', value: { r: 0.2, g: 0.4, b: 0.8 } },
];

function colorToCss(c: WatermarkColor): string {
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

interface PreviewProps {
  pdf: any;
  text: string;
  fontSize: number;
  opacity: number;
  color: WatermarkColor;
  rotation: number;
  position: WatermarkPosition;
}

function WatermarkPreview({
  pdf,
  text,
  fontSize,
  opacity,
  color,
  rotation,
  position,
}: PreviewProps) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    import('@/lib/processing/pdf-client').then(({ renderPdfPage }) => {
      renderPdfPage(pdf, 1, 0.5).then((c) => {
        if (!cancelled) setCanvas(c);
      });
    });
    return () => { cancelled = true; };
  }, [pdf]);

  return (
    <div className="relative inline-block border border-border bg-muted/20">
      {canvas ? (
        <PdfPagePreviewImage
          canvas={canvas}
          alt="Preview"
          className="block max-w-full h-auto"
        />
      ) : (
        <div className="w-[300px] aspect-[3/4] flex items-center justify-center">
          <span className="text-[10px] font-mono text-muted-foreground">...</span>
        </div>
      )}
      {canvas && text && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden"
        >
          <span
            className="font-bold whitespace-nowrap select-none"
            style={{
              fontSize: `${fontSize * 0.5}px`,
              color: colorToCss(color),
              opacity,
              transform: `rotate(${position === 'diagonal' ? rotation : 0}deg)`,
            }}
          >
            {text}
          </span>
        </div>
      )}
    </div>
  );
}

export default function WatermarkPage() {
  const t = useTranslations('PdfTool');
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [pdf, setPdf] = useState<any>(null);
  const [pageCount, setPageCount] = useState(0);
  const [text, setText] = useState('');
  const [fontSize, setFontSize] = useState(48);
  const [opacity, setOpacity] = useState(0.3);
  const [colorKey, setColorKey] = useState<'gray' | 'red' | 'blue'>('gray');
  const [position, setPosition] = useState<WatermarkPosition>('diagonal');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: session } = authClient.useSession();
  const uploadFile = useUploadFile();
  const createTask = useCreateTask();

  const color = COLOR_PRESETS.find((p) => p.key === colorKey)!.value;
  const rotation = position === 'diagonal' ? -45 : 0;

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
        setResult(
          new File([blob], `${baseName}-watermark.pdf`, { type: 'application/pdf' }),
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
    return () => { cancelled = true; };
  }, [file]);

  const handleDrop = useCallback((files: File[]) => {
    const pdfFile = files.find((f) => f.type === 'application/pdf');
    if (!pdfFile) return;
    setFile(pdfFile);
    setPdf(null);
    setPageCount(0);
    setResult(null);
    setError(null);
  }, []);

  const handleStart = async () => {
    if (!file || !text.trim()) return;

    if (!session) {
      const next = encodeURIComponent('/pdf/watermark');
      router.push(`/login?next=${next}`);
      return;
    }

    setProcessing(true);
    setError(null);
    setResult(null);

    try {
      const uploaded = (await uploadFile.mutateAsync(file)) as any;

      const inputConfig = {
        text: text.trim(),
        fontSize,
        opacity,
        color,
        rotation,
        position,
      };

      const task = await createTask.mutateAsync({
        type: 'pdf_watermark',
        inputFileIds: [uploaded.id],
        inputConfig,
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
        <h1 className="text-lg font-medium">{t('watermark.title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t('watermark.description')}
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
                {pageCount} {t('watermark.pages')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setFile(null);
                setPdf(null);
                setResult(null);
              }}
              className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('watermark.changeFile')}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                  {t('watermark.text')}
                </label>
                <input
                  type="text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={t('watermark.textPlaceholder')}
                  disabled={processing}
                  className="w-full h-9 px-3 text-sm font-mono bg-transparent border border-border rounded-md focus:border-accent focus:outline-none disabled:opacity-50"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                  {t('watermark.fontSize')}
                </label>
                <input
                  type="number"
                  min={24}
                  max={120}
                  step={1}
                  value={fontSize}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) {
                      setFontSize(Math.max(24, Math.min(120, n)));
                    }
                  }}
                  disabled={processing}
                  className="w-24 h-9 px-3 text-sm font-mono bg-transparent border border-border rounded-md focus:border-accent focus:outline-none tabular-nums disabled:opacity-50"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider flex justify-between">
                  <span>{t('watermark.opacity')}</span>
                  <span className="tabular-nums">{opacity.toFixed(2)}</span>
                </label>
                <input
                  type="range"
                  min={0.05}
                  max={0.5}
                  step={0.05}
                  value={opacity}
                  onChange={(e) => setOpacity(Number(e.target.value))}
                  disabled={processing}
                  className="w-full accent-foreground disabled:opacity-50"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                  {t('watermark.color')}
                </label>
                <div className="flex gap-2">
                  {COLOR_PRESETS.map(({ key, value }) => {
                    const labelKey =
                      key === 'gray'
                        ? 'watermark.colorGray'
                        : key === 'red'
                          ? 'watermark.colorRed'
                          : 'watermark.colorBlue';
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setColorKey(key)}
                        disabled={processing}
                        className={cn(
                          'flex items-center gap-2 px-3 h-9 text-sm font-mono border rounded-md transition-colors',
                          colorKey === key
                            ? 'border-accent text-foreground bg-accent/10'
                            : 'border-border text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <span
                          className="inline-block w-3 h-3 rounded-sm border border-border/60"
                          style={{ backgroundColor: colorToCss(value) }}
                        />
                        {t(labelKey)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                  {t('watermark.position')}
                </label>
                <div className="flex gap-2">
                  {(['center', 'diagonal'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPosition(p)}
                      disabled={processing}
                      className={cn(
                        'px-4 h-9 text-sm font-mono border rounded-md transition-colors',
                        position === p
                          ? 'border-accent text-foreground bg-accent/10'
                          : 'border-border text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {p === 'center'
                        ? t('watermark.positionCenter')
                        : t('watermark.positionDiagonal')}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                {t('watermark.rotation')}
              </label>
              <div className="flex items-start justify-center bg-muted/10 border border-border rounded-md p-4 min-h-[300px]">
                <WatermarkPreview
                  pdf={pdf}
                  text={text || t('watermark.textPlaceholder')}
                  fontSize={fontSize}
                  opacity={text ? opacity : opacity * 0.5}
                  color={color}
                  rotation={rotation}
                  position={position}
                />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleStart}
            disabled={processing || !text.trim()}
            className="w-full h-10 text-sm font-mono bg-foreground text-background rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {processing ? t('watermark.processing') : t('watermark.start')}
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

      {result && (
        <div className="flex justify-end">
          <DownloadButton file={result} />
        </div>
      )}
    </div>
  );
}
