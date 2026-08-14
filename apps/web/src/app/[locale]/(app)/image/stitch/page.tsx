'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { FileDropzone } from '@/components/tools/file-dropzone';
import {
  SortableImageList,
  type SortableImageFile,
} from '@/components/tools/sortable-image-list';
import { ProcessingProgress } from '@/components/tools/processing-progress';
import { DownloadButton } from '@/components/tools/download-button';
import { ZipDownloadButton } from '@/components/tools/zip-download-button';
import { ToolPageShell } from '@/components/tools/tool-page-shell';
import { FailureRecoveryPanel } from '@/components/tools/failure-recovery-panel';
import { ResultPanel } from '@/components/tools/result-panel';
import {
  getImageStitchEntitlements,
  stitchImages,
  type ImageStitchOutputType,
} from '@/lib/processing/image-stitch-client';
import { createBrowserId } from '@/lib/browser-id';
import { getToolByHref } from '@/lib/tools/tool-metadata';
import { cn } from '@/lib/utils';

type WidthPreset = '750' | '1080' | '1242' | 'custom';
type BackgroundPreset = 'white' | 'black' | 'transparent' | 'custom';

interface StitchOptionsState {
  widthPreset: WidthPreset;
  customWidth: number;
  gap: number;
  backgroundPreset: BackgroundPreset;
  customBackground: string;
  outputType: ImageStitchOutputType;
  quality: number;
  filename: string;
}

const WIDTH_PRESETS: WidthPreset[] = ['750', '1080', '1242', 'custom'];
const BACKGROUND_PRESETS: BackgroundPreset[] = [
  'white',
  'black',
  'transparent',
  'custom',
];
const OUTPUT_TYPES: ImageStitchOutputType[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
];

const BACKGROUND_VALUES: Record<Exclude<BackgroundPreset, 'custom'>, string> = {
  white: '#ffffff',
  black: '#000000',
  transparent: 'transparent',
};

const OUTPUT_LABELS: Record<ImageStitchOutputType, string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
};

function makeImageId(file: File): string {
  return `${file.name}-${file.lastModified}-${file.size}-${createBrowserId()}`;
}

function resolveWidth(options: StitchOptionsState): number {
  if (options.widthPreset === 'custom') return options.customWidth;
  return Number(options.widthPreset);
}

function resolveBackground(options: StitchOptionsState): string {
  if (options.backgroundPreset === 'custom') return options.customBackground;
  return BACKGROUND_VALUES[options.backgroundPreset];
}

function parseBatchWidths(value: string): number[] {
  return value
    .split(',')
    .map(part => Number(part.trim()))
    .filter(width => Number.isFinite(width) && width > 0)
    .map(width => Math.round(width));
}

export default function ImageStitchPage() {
  const t = useTranslations('ImageStitch');
  const tShell = useTranslations('ToolShell');
  const tool = getToolByHref('/image/stitch')!;
  const router = useRouter();
  const { data: session, isPending: sessionLoading } = authClient.useSession();
  const entitlements = getImageStitchEntitlements(session);
  const [files, setFiles] = useState<SortableImageFile[]>([]);
  const [options, setOptions] = useState<StitchOptionsState>({
    widthPreset: '1080',
    customWidth: 1080,
    gap: 0,
    backgroundPreset: 'white',
    customBackground: '#ffffff',
    outputType: 'image/png',
    quality: 0.92,
    filename: 'stitched-long-image',
  });
  const [batchWidths, setBatchWidths] = useState('750,1080');
  const [brandFooter, setBrandFooter] = useState('');
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const controlsDisabled = processing || sessionLoading;

  const outputWidth = resolveWidth(options);
  const background = resolveBackground(options);
  const hasResults = results.length > 0;
  const canGenerate = files.length >= 2 && !controlsDisabled;
  const batchWidthValues = useMemo(
    () => (session ? parseBatchWidths(batchWidths) : []),
    [batchWidths, session]
  );
  const stage = hasResults
    ? 'result'
    : processing
      ? 'processing'
      : files.length > 0
        ? 'configure'
        : 'upload';

  const handleDrop = (dropped: File[]) => {
    if (dropped.length === 0) return;

    const availableSlots = entitlements.maxFiles - files.length;
    if (availableSlots <= 0) {
      setError(t('limits.maxFiles', { count: entitlements.maxFiles }));
      return;
    }

    const accepted = dropped
      .filter(file => file.size <= entitlements.maxFileSize)
      .slice(0, availableSlots);

    if (accepted.length < dropped.length) {
      setError(
        dropped.some(file => file.size > entitlements.maxFileSize)
          ? t('limits.maxFileSize')
          : t('limits.maxFiles', { count: entitlements.maxFiles })
      );
    } else {
      setError(null);
    }

    setFiles(prev => [
      ...prev,
      ...accepted.map(file => ({ id: makeImageId(file), file })),
    ]);
    setResults([]);
    setProgress(0);
  };

  const handleRemove = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
    setResults([]);
  };

  const handleReset = () => {
    setFiles([]);
    setResults([]);
    setError(null);
    setProgress(0);
    setProcessing(false);
  };

  const handleCommercialLogin = () => {
    const next = encodeURIComponent('/image/stitch');
    router.push(`/login?next=${next}`);
  };

  const handleGenerate = async () => {
    if (sessionLoading) return;

    if (files.length < 2) {
      setError(t('limits.needAtLeastTwo'));
      return;
    }

    if (!Number.isFinite(outputWidth) || outputWidth <= 0) {
      setError(t('limits.invalidWidth'));
      return;
    }

    const widths = session
      ? batchWidthValues.length > 0
        ? batchWidthValues
        : [outputWidth]
      : [outputWidth];

    if (session && batchWidths.trim() && batchWidthValues.length === 0) {
      setError(t('limits.invalidBatchWidths'));
      return;
    }

    setProcessing(true);
    setError(null);
    setProgress(0);
    setResults([]);

    try {
      const generated: File[] = [];
      for (let i = 0; i < widths.length; i += 1) {
        const width = widths[i]!;
        const result = await stitchImages(
          files.map(item => item.file),
          {
            width,
            gap: options.gap,
            background,
            outputType: options.outputType,
            quality: options.quality,
            filename:
              widths.length > 1
                ? `${options.filename}-${width}`
                : options.filename,
            brandFooter: brandFooter.trim() || undefined,
          },
          entitlements
        );
        generated.push(result);
        setProgress(Math.round(((i + 1) / widths.length) * 100));
      }
      setResults(generated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProcessing(false);
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
      <FileDropzone
        accept={{ 'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.avif'] }}
        maxSize={entitlements.maxFileSize}
        multiple
        onDrop={handleDrop}
        disabled={controlsDisabled}
        hint={t('dropzoneHint')}
        processingLabel={t('processingLabel')}
      />

      {files.length > 0 && (
        <div className="space-y-6">
          <SortableImageList
            files={files}
            onReorder={next => {
              setFiles(next);
              setResults([]);
            }}
            onRemove={handleRemove}
            disabled={processing}
          />

          <section className="space-y-5 rounded-md border border-border p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t('outputWidth')}
                </div>
                <div className="flex flex-wrap gap-2">
                  {WIDTH_PRESETS.map(preset => (
                    <button
                      key={preset}
                      type="button"
                      disabled={processing}
                      onClick={() =>
                        setOptions(prev => ({ ...prev, widthPreset: preset }))
                      }
                      className={cn(
                        'h-8 rounded-md border px-3 font-mono text-xs transition-colors',
                        options.widthPreset === preset
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-border text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {t(`presets.${preset}`)}
                    </button>
                  ))}
                </div>
              </div>

              {options.widthPreset === 'custom' && (
                <label className="space-y-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {t('widthPx')}
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={options.customWidth}
                    disabled={processing}
                    onChange={event =>
                      setOptions(prev => ({
                        ...prev,
                        customWidth: Number(event.target.value),
                      }))
                    }
                    className="h-9 w-full rounded-md border border-border bg-transparent px-3 font-mono text-sm focus:border-accent focus:outline-none disabled:opacity-50"
                  />
                </label>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t('gap')}
                  <span className="text-foreground">{options.gap}px</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={80}
                  step={1}
                  value={options.gap}
                  disabled={processing}
                  onChange={event =>
                    setOptions(prev => ({
                      ...prev,
                      gap: Number(event.target.value),
                    }))
                  }
                  className="w-full accent-accent"
                />
              </label>

              <label className="space-y-2">
                <span className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t('quality')}
                  <span className="text-foreground">
                    {Math.round(options.quality * 100)}%
                  </span>
                </span>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.01}
                  value={options.quality}
                  disabled={processing || options.outputType === 'image/png'}
                  onChange={event =>
                    setOptions(prev => ({
                      ...prev,
                      quality: Number(event.target.value),
                    }))
                  }
                  className="w-full accent-accent disabled:opacity-50"
                />
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t('background')}
                </div>
                <div className="flex flex-wrap gap-2">
                  {BACKGROUND_PRESETS.map(preset => (
                    <button
                      key={preset}
                      type="button"
                      disabled={processing}
                      onClick={() =>
                        setOptions(prev => ({
                          ...prev,
                          backgroundPreset: preset,
                        }))
                      }
                      className={cn(
                        'flex h-8 items-center gap-2 rounded-md border px-3 font-mono text-xs transition-colors',
                        options.backgroundPreset === preset
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-border text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <span
                        className="h-3 w-3 rounded-sm border border-border"
                        style={{
                          background:
                            preset === 'transparent'
                              ? 'repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50% / 6px 6px'
                              : preset === 'custom'
                                ? options.customBackground
                                : BACKGROUND_VALUES[preset],
                        }}
                      />
                      {t(`backgrounds.${preset}`)}
                    </button>
                  ))}
                </div>
              </div>

              {options.backgroundPreset === 'custom' && (
                <label className="space-y-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {t('backgroundColor')}
                  </span>
                  <input
                    type="color"
                    value={options.customBackground}
                    disabled={processing}
                    onChange={event =>
                      setOptions(prev => ({
                        ...prev,
                        customBackground: event.target.value,
                      }))
                    }
                    className="h-9 w-full rounded-md border border-border bg-transparent p-1 disabled:opacity-50"
                  />
                </label>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t('outputFormat')}
                </div>
                <div className="inline-flex rounded-md border border-border p-0.5">
                  {OUTPUT_TYPES.map(type => (
                    <button
                      key={type}
                      type="button"
                      disabled={processing}
                      onClick={() =>
                        setOptions(prev => ({ ...prev, outputType: type }))
                      }
                      className={cn(
                        'h-8 rounded-sm px-3 font-mono text-xs transition-colors',
                        options.outputType === type
                          ? 'bg-foreground text-background'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {OUTPUT_LABELS[type]}
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
                  value={options.filename}
                  placeholder={t('filenamePlaceholder')}
                  disabled={processing}
                  onChange={event =>
                    setOptions(prev => ({
                      ...prev,
                      filename: event.target.value,
                    }))
                  }
                  className="h-9 w-full rounded-md border border-border bg-transparent px-3 font-mono text-sm focus:border-accent focus:outline-none disabled:opacity-50"
                />
              </label>
            </div>
          </section>

          {session ? (
            <section className="space-y-4 rounded-md border border-border p-4">
              <div>
                <h2 className="text-sm font-medium">{t('commercialTitle')}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('commercialDescription')}
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {t('batchWidths')}
                  </span>
                  <input
                    type="text"
                    value={batchWidths}
                    disabled={processing}
                    onChange={event => setBatchWidths(event.target.value)}
                    className="h-9 w-full rounded-md border border-border bg-transparent px-3 font-mono text-sm focus:border-accent focus:outline-none disabled:opacity-50"
                  />
                  <span className="block text-xs text-muted-foreground">
                    {t('batchWidthsHint')}
                  </span>
                </label>

                <label className="space-y-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {t('brandFooter')}
                  </span>
                  <input
                    type="text"
                    value={brandFooter}
                    disabled={processing}
                    placeholder={t('brandFooterPlaceholder')}
                    onChange={event => setBrandFooter(event.target.value)}
                    className="h-9 w-full rounded-md border border-border bg-transparent px-3 font-mono text-sm focus:border-accent focus:outline-none disabled:opacity-50"
                  />
                  <span className="block text-xs text-muted-foreground">
                    {t('brandFooterHint')}
                  </span>
                </label>
              </div>
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
                disabled={controlsDisabled}
                className="h-9 shrink-0 rounded-md border border-border px-3 font-mono text-xs text-foreground transition-colors hover:bg-muted/40 disabled:opacity-50"
              >
                {t('loginAction')}
              </button>
            </section>
          )}

          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="h-10 w-full rounded-md bg-foreground font-mono text-sm text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {processing
              ? t('processing')
              : files.length > 1
                ? t('startWithCount', { count: files.length })
                : t('start')}
          </button>
        </div>
      )}

      {processing && (
        <ProcessingProgress progress={progress} stage="processing" />
      )}

      {error && (
        <FailureRecoveryPanel
          message={error}
          onRetry={handleGenerate}
          onReset={handleReset}
        />
      )}

      {hasResults && (
        <ResultPanel
          title={
            results.length === 1
              ? t('resultTitle')
              : t('batchResultTitle', { count: results.length })
          }
          description={
            results.length === 1
              ? results[0]!.name
              : tShell('result.filesReady', { count: results.length })
          }
          action={
            results.length === 1 ? (
              <DownloadButton file={results[0]!} />
            ) : (
              <ZipDownloadButton
                files={results}
                zipName="stitched-long-images.zip"
              />
            )
          }
        />
      )}
    </ToolPageShell>
  );
}
