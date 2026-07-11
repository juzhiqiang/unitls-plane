'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { FileDropzone } from '@/components/tools/file-dropzone';
import {
  AnimationFrameList,
  type AnimationFrameFile,
} from '@/components/tools/animation-frame-list';
import { ProcessingProgress } from '@/components/tools/processing-progress';
import { DownloadButton } from '@/components/tools/download-button';
import { ToolPageShell } from '@/components/tools/tool-page-shell';
import { FailureRecoveryPanel } from '@/components/tools/failure-recovery-panel';
import { ResultPanel } from '@/components/tools/result-panel';
import {
  compressGif,
  createAnimationFromImages,
  getImageAnimationEntitlements,
  type AnimationFitMode,
  type AnimationOutputFormat,
} from '@/lib/processing/image-animation-client';
import { formatBytes } from '@/lib/format';
import { getToolByHref } from '@/lib/tools/tool-metadata';
import { cn } from '@/lib/utils';

type AnimationMode = 'create' | 'compress' | 'convert';
type ResultKind = 'create' | 'compress';

interface CreateOptionsState {
  outputFormat: AnimationOutputFormat;
  width: number;
  height: number;
  fit: AnimationFitMode;
  background: string;
  frameDelayMs: number;
  repeat: number;
  quality: number;
  filename: string;
}

interface CompressOptionsState {
  targetWidth: number;
  targetFps: number;
  quality: number;
  filename: string;
}

const MODES: AnimationMode[] = ['create', 'compress', 'convert'];
const OUTPUT_FORMATS: AnimationOutputFormat[] = ['gif', 'apng'];
const FIT_MODES: AnimationFitMode[] = ['contain', 'cover'];

const OUTPUT_FORMAT_LABELS: Record<AnimationOutputFormat, string> = {
  gif: 'GIF',
  apng: 'APNG',
};

function makeFrameId(file: File): string {
  return `${file.name}-${file.lastModified}-${file.size}-${crypto.randomUUID()}`;
}

function isGifFile(file: File): boolean {
  return file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif');
}

function AnimationResultPreview({
  file,
  label,
}: {
  file: File;
  label: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  if (!url) return null;

  return (
    <div className="overflow-hidden rounded-md border border-border bg-muted/30">
      {/* GIF/APNG playback is handled by the browser image decoder. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={label}
        className="mx-auto max-h-[420px] w-full object-contain"
        draggable={false}
      />
    </div>
  );
}

export default function ImageAnimationPage() {
  const t = useTranslations('ImageAnimation');
  const tShell = useTranslations('ToolShell');
  const tUnits = useTranslations('Common.units');
  const locale = useLocale();
  const tool = getToolByHref('/image/animation')!;
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const entitlements = getImageAnimationEntitlements(session);
  const [mode, setMode] = useState<AnimationMode>('create');
  const [frames, setFrames] = useState<AnimationFrameFile[]>([]);
  const [gifFile, setGifFile] = useState<File | null>(null);
  const [createOptions, setCreateOptions] = useState<CreateOptionsState>({
    outputFormat: 'gif',
    width: 640,
    height: 640,
    fit: 'contain',
    background: '#ffffff',
    frameDelayMs: 160,
    repeat: 0,
    quality: 12,
    filename: 'animated-image',
  });
  const [compressOptions, setCompressOptions] = useState<CompressOptionsState>({
    targetWidth: 640,
    targetFps: 15,
    quality: 16,
    filename: 'compressed-animation',
  });
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<File | null>(null);
  const [resultKind, setResultKind] = useState<ResultKind>('create');
  const [originalSize, setOriginalSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stage = result
    ? 'result'
    : processing
      ? 'processing'
      : (mode === 'create' && frames.length > 0) ||
          (mode === 'compress' && gifFile)
        ? 'configure'
        : 'upload';
  const canCreate =
    frames.length >= 2 &&
    !processing &&
    (createOptions.outputFormat !== 'apng' || entitlements.canExportApng);
  const canCompress = Boolean(gifFile) && !processing;

  const clearProcessingState = () => {
    setResult(null);
    setOriginalSize(null);
    setError(null);
    setProgress(0);
    setProcessing(false);
  };

  const handleModeChange = (nextMode: AnimationMode) => {
    setMode(nextMode);
    clearProcessingState();
  };

  const handleReset = () => {
    setFrames([]);
    setGifFile(null);
    setResult(null);
    setOriginalSize(null);
    setError(null);
    setProgress(0);
    setProcessing(false);
  };

  const handleCommercialLogin = () => {
    router.push(`/login?next=${encodeURIComponent('/image/animation')}`);
  };

  const handleCreateDrop = (dropped: File[]) => {
    if (dropped.length === 0) return;

    const maxFrames = Math.min(
      entitlements.maxInputFiles,
      entitlements.maxFrames
    );
    const availableSlots = maxFrames - frames.length;

    if (availableSlots <= 0) {
      setError(t('limits.processingFailed'));
      return;
    }

    const accepted = dropped.slice(0, availableSlots);
    setFrames(prev => [
      ...prev,
      ...accepted.map(file => ({
        id: makeFrameId(file),
        file,
        delayMs: createOptions.frameDelayMs,
      })),
    ]);
    setResult(null);
    setOriginalSize(null);
    setProgress(0);
    setError(
      accepted.length < dropped.length ? t('limits.processingFailed') : null
    );
  };

  const handleGifDrop = (dropped: File[]) => {
    const file = dropped[0];
    if (!file) return;

    if (!isGifFile(file)) {
      setGifFile(null);
      setError(t('limits.gifOnly'));
      return;
    }

    setGifFile(file);
    setResult(null);
    setOriginalSize(null);
    setProgress(0);
    setError(null);
  };

  const updateFrameDelay = (frameDelayMs: number) => {
    setCreateOptions(prev => ({ ...prev, frameDelayMs }));
    setFrames(prev => prev.map(frame => ({ ...frame, delayMs: frameDelayMs })));
  };

  const handleCreate = async () => {
    if (frames.length < 2) {
      setError(t('limits.needAtLeastTwo'));
      return;
    }

    if (createOptions.outputFormat === 'apng' && !entitlements.canExportApng) {
      setError(t('limits.apngLogin'));
      return;
    }

    if (
      !Number.isFinite(createOptions.width) ||
      !Number.isFinite(createOptions.height) ||
      createOptions.width <= 0 ||
      createOptions.height <= 0
    ) {
      setError(t('limits.invalidSize'));
      return;
    }

    setProcessing(true);
    setError(null);
    setResult(null);
    setOriginalSize(null);
    setProgress(8);

    try {
      const generated = await createAnimationFromImages(
        frames.map(frame => frame.file),
        createOptions,
        entitlements
      );
      setResult(generated);
      setResultKind('create');
      setProgress(100);
    } catch (err) {
      setError((err as Error).message || t('limits.processingFailed'));
    } finally {
      setProcessing(false);
    }
  };

  const handleCompress = async () => {
    if (!gifFile) {
      setError(t('limits.gifOnly'));
      return;
    }

    setProcessing(true);
    setError(null);
    setResult(null);
    setOriginalSize(null);
    setProgress(8);

    try {
      const compressed = await compressGif(
        gifFile,
        compressOptions,
        entitlements
      );
      setResult(compressed);
      setResultKind('compress');
      setOriginalSize(gifFile.size);
      setProgress(100);
    } catch (err) {
      setError((err as Error).message || t('limits.processingFailed'));
    } finally {
      setProcessing(false);
    }
  };

  const handleRetry = () => {
    if (mode === 'compress') {
      void handleCompress();
      return;
    }
    if (mode === 'create') {
      void handleCreate();
    }
  };

  return (
    <ToolPageShell
      title={t('title')}
      description={t('description')}
      processing={tool.processing}
      retention={tool.retention}
      requiresLogin={tool.requiresLogin}
      recovery={tShell('catalogRecovery')}
      stage={stage}
    >
      <div className="inline-flex w-full rounded-md border border-border p-0.5 sm:w-auto">
        {MODES.map(item => (
          <button
            key={item}
            type="button"
            disabled={processing}
            onClick={() => handleModeChange(item)}
            className={cn(
              'h-9 min-w-24 flex-1 rounded-sm px-3 font-mono text-xs transition-colors sm:flex-none',
              mode === item
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t(`modes.${item}`)}
          </button>
        ))}
      </div>

      {mode === 'create' && (
        <>
          <FileDropzone
            accept={{ 'image/*': ['.jpg', '.jpeg', '.png', '.webp'] }}
            maxSize={entitlements.maxFileSize}
            multiple
            onDrop={handleCreateDrop}
            disabled={processing}
            hint={t('dropzoneCreateHint')}
            processingLabel={t('processingLabel')}
          />

          {frames.length > 0 && (
            <div className="space-y-6">
              <AnimationFrameList
                frames={frames}
                onReorder={next => {
                  setFrames(next);
                  setResult(null);
                }}
                onRemove={index => {
                  setFrames(prev => prev.filter((_, i) => i !== index));
                  setResult(null);
                }}
                disabled={processing}
              />

              <section className="space-y-5 rounded-md border border-border p-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {t('outputFormat')}
                    </div>
                    <div className="inline-flex rounded-md border border-border p-0.5">
                      {OUTPUT_FORMATS.map(format => (
                        <button
                          key={format}
                          type="button"
                          disabled={
                            processing ||
                            (format === 'apng' && !entitlements.canExportApng)
                          }
                          onClick={() =>
                            setCreateOptions(prev => ({
                              ...prev,
                              outputFormat: format,
                            }))
                          }
                          className={cn(
                            'h-8 min-w-16 rounded-sm px-3 font-mono text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                            createOptions.outputFormat === format
                              ? 'bg-foreground text-background'
                              : 'text-muted-foreground hover:text-foreground'
                          )}
                        >
                          {OUTPUT_FORMAT_LABELS[format]}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="space-y-2">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {t('filename')}
                    </span>
                    <input
                      type="text"
                      value={createOptions.filename}
                      placeholder={t('filenamePlaceholder')}
                      disabled={processing}
                      onChange={event =>
                        setCreateOptions(prev => ({
                          ...prev,
                          filename: event.target.value,
                        }))
                      }
                      className="h-9 w-full rounded-md border border-border bg-transparent px-3 font-mono text-sm focus:border-accent focus:outline-none disabled:opacity-50"
                    />
                  </label>
                </div>

                <div className="space-y-2">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {t('canvasSize')}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-2">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        {t('width')}
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={entitlements.maxOutputWidth}
                        value={createOptions.width}
                        disabled={processing}
                        onChange={event =>
                          setCreateOptions(prev => ({
                            ...prev,
                            width: Number(event.target.value),
                          }))
                        }
                        className="h-9 w-full rounded-md border border-border bg-transparent px-3 font-mono text-sm tabular-nums focus:border-accent focus:outline-none disabled:opacity-50"
                      />
                    </label>

                    <label className="space-y-2">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        {t('height')}
                      </span>
                      <input
                        type="number"
                        min={1}
                        value={createOptions.height}
                        disabled={processing}
                        onChange={event =>
                          setCreateOptions(prev => ({
                            ...prev,
                            height: Number(event.target.value),
                          }))
                        }
                        className="h-9 w-full rounded-md border border-border bg-transparent px-3 font-mono text-sm tabular-nums focus:border-accent focus:outline-none disabled:opacity-50"
                      />
                    </label>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {t('fit')}
                    </div>
                    <div className="inline-flex rounded-md border border-border p-0.5">
                      {FIT_MODES.map(fit => (
                        <button
                          key={fit}
                          type="button"
                          disabled={processing}
                          onClick={() =>
                            setCreateOptions(prev => ({ ...prev, fit }))
                          }
                          className={cn(
                            'h-8 min-w-20 rounded-sm px-3 font-mono text-xs transition-colors',
                            createOptions.fit === fit
                              ? 'bg-foreground text-background'
                              : 'text-muted-foreground hover:text-foreground'
                          )}
                        >
                          {t(fit)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="space-y-2">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {t('background')}
                    </span>
                    <input
                      type="color"
                      value={createOptions.background}
                      disabled={processing}
                      onChange={event =>
                        setCreateOptions(prev => ({
                          ...prev,
                          background: event.target.value,
                        }))
                      }
                      className="h-9 w-full rounded-md border border-border bg-transparent p-1 disabled:opacity-50"
                    />
                  </label>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <label className="space-y-2">
                    <span className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {t('frameDelay')}
                      <span className="text-foreground">
                        {createOptions.frameDelayMs} ms
                      </span>
                    </span>
                    <input
                      type="range"
                      min={20}
                      max={1000}
                      step={20}
                      value={createOptions.frameDelayMs}
                      disabled={processing}
                      onChange={event =>
                        updateFrameDelay(Number(event.target.value))
                      }
                      className="w-full accent-accent"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {t('loop')}
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={createOptions.repeat}
                      disabled={processing}
                      onChange={event =>
                        setCreateOptions(prev => ({
                          ...prev,
                          repeat: Number(event.target.value),
                        }))
                      }
                      className="h-9 w-full rounded-md border border-border bg-transparent px-3 font-mono text-sm tabular-nums focus:border-accent focus:outline-none disabled:opacity-50"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {t('quality')}
                      <span className="text-foreground">
                        {createOptions.quality}
                      </span>
                    </span>
                    <input
                      type="range"
                      min={1}
                      max={30}
                      step={1}
                      value={createOptions.quality}
                      disabled={processing}
                      onChange={event =>
                        setCreateOptions(prev => ({
                          ...prev,
                          quality: Number(event.target.value),
                        }))
                      }
                      className="w-full accent-accent"
                    />
                  </label>
                </div>
              </section>

              <button
                type="button"
                onClick={handleCreate}
                disabled={!canCreate}
                className="h-10 w-full rounded-md bg-foreground font-mono text-sm text-background transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {processing
                  ? t('processing')
                  : frames.length > 1
                    ? t('startWithCount', { count: frames.length })
                    : t('start')}
              </button>
            </div>
          )}
        </>
      )}

      {mode === 'compress' && (
        <>
          <FileDropzone
            accept={{ 'image/gif': ['.gif'] }}
            maxSize={entitlements.maxFileSize}
            multiple={false}
            onDrop={handleGifDrop}
            disabled={processing}
            hint={t('dropzoneCompressHint')}
            processingLabel={t('processingLabel')}
          />

          {gifFile && (
            <div className="space-y-6">
              <section className="rounded-md border border-border p-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <p className="truncate font-mono text-xs text-foreground">
                    {gifFile.name}
                  </p>
                  <p className="font-mono text-xs tabular-nums text-muted-foreground">
                    {formatBytes(gifFile.size, tUnits, locale)}
                  </p>
                </div>
              </section>

              <section className="space-y-5 rounded-md border border-border p-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {t('targetWidth')}
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={entitlements.maxOutputWidth}
                      value={compressOptions.targetWidth}
                      disabled={processing}
                      onChange={event =>
                        setCompressOptions(prev => ({
                          ...prev,
                          targetWidth: Number(event.target.value),
                        }))
                      }
                      className="h-9 w-full rounded-md border border-border bg-transparent px-3 font-mono text-sm tabular-nums focus:border-accent focus:outline-none disabled:opacity-50"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {t('targetFps')}
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={compressOptions.targetFps}
                      disabled={processing}
                      onChange={event =>
                        setCompressOptions(prev => ({
                          ...prev,
                          targetFps: Number(event.target.value),
                        }))
                      }
                      className="h-9 w-full rounded-md border border-border bg-transparent px-3 font-mono text-sm tabular-nums focus:border-accent focus:outline-none disabled:opacity-50"
                    />
                  </label>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {t('quality')}
                      <span className="text-foreground">
                        {compressOptions.quality}
                      </span>
                    </span>
                    <input
                      type="range"
                      min={1}
                      max={30}
                      step={1}
                      value={compressOptions.quality}
                      disabled={processing}
                      onChange={event =>
                        setCompressOptions(prev => ({
                          ...prev,
                          quality: Number(event.target.value),
                        }))
                      }
                      className="w-full accent-accent"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {t('filename')}
                    </span>
                    <input
                      type="text"
                      value={compressOptions.filename}
                      placeholder={t('filenamePlaceholder')}
                      disabled={processing}
                      onChange={event =>
                        setCompressOptions(prev => ({
                          ...prev,
                          filename: event.target.value,
                        }))
                      }
                      className="h-9 w-full rounded-md border border-border bg-transparent px-3 font-mono text-sm focus:border-accent focus:outline-none disabled:opacity-50"
                    />
                  </label>
                </div>
              </section>

              <button
                type="button"
                onClick={handleCompress}
                disabled={!canCompress}
                className="h-10 w-full rounded-md bg-foreground font-mono text-sm text-background transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {processing ? t('processing') : t('compressAction')}
              </button>
            </div>
          )}
        </>
      )}

      {mode === 'convert' && (
        <section className="rounded-md border border-border p-4">
          <h2 className="text-sm font-medium">{t('convertTitle')}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('convertDescription')}
          </p>
        </section>
      )}

      {session ? (
        <section className="rounded-md border border-border p-4">
          <h2 className="text-sm font-medium">{t('commercialTitle')}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('commercialDescription')}
          </p>
        </section>
      ) : (
        <section className="flex flex-col gap-3 rounded-md border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-medium">{t('loginTitle')}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('loginDescription')}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCommercialLogin}
            className="h-9 shrink-0 rounded-md border border-border px-3 font-mono text-xs text-foreground transition-colors hover:bg-muted/40"
          >
            {t('loginAction')}
          </button>
        </section>
      )}

      {processing && (
        <ProcessingProgress
          progress={progress}
          stage="processing"
          label={t('processing')}
        />
      )}

      {error && (
        <FailureRecoveryPanel
          message={error}
          onRetry={mode === 'convert' ? undefined : handleRetry}
          onReset={handleReset}
        />
      )}

      {result && (
        <ResultPanel
          title={
            resultKind === 'compress'
              ? t('compressedResultTitle')
              : t('resultTitle')
          }
          description={
            resultKind === 'compress' && originalSize !== null
              ? t('compressionResultDescription', {
                  before: formatBytes(originalSize, tUnits, locale),
                  after: formatBytes(result.size, tUnits, locale),
                })
              : t('resultDescription', {
                  name: result.name,
                  size: formatBytes(result.size, tUnits, locale),
                })
          }
          preview={
            <AnimationResultPreview file={result} label={t('previewAlt')} />
          }
          action={<DownloadButton file={result} />}
        />
      )}
    </ToolPageShell>
  );
}
