'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { FileList, type FileItem } from '@/components/tools/file-list';
import { ModeToggle, type ProcessMode } from '@/components/tools/mode-toggle';
import { ProcessingProgress } from '@/components/tools/processing-progress';
import { ImageCompare } from '@/components/tools/image-compare';
import { DownloadButton } from '@/components/tools/download-button';
import { ZipDownloadButton } from '@/components/tools/zip-download-button';
import { ToolPageShell } from '@/components/tools/tool-page-shell';
import { FailureRecoveryPanel } from '@/components/tools/failure-recovery-panel';
import { ResultPanel } from '@/components/tools/result-panel';
import {
  DEFAULT_IMAGE_TRANSFORM,
  ImageTransformOptions,
} from '@/components/tools/image-transform-options';
import { useUploadFile } from '@/hooks/api/use-files';
import { useCreateTask } from '@/hooks/api/use-tasks';
import { shouldProcessLocally } from '@/lib/processing/image-client';
import {
  toServerTransformConfig,
  type NormalizedImageTransform,
} from '@/lib/processing/image-transform-client';
import {
  colorToCss,
  watermarkImage,
  type ImageWatermarkColor,
  type ImageWatermarkOutputType,
  type ImageWatermarkPosition,
  type ImageWatermarkOptions,
  type ImageWatermarkKind,
  DEFAULT_LOGO_SCALE,
} from '@/lib/processing/image-watermark-client';
import { IMAGE_WATERMARK_GRID } from '@utils-plane/validators';
import { getToolByHref } from '@/lib/tools/tool-metadata';
import { getImageUploadMaxFileSize } from '@/lib/tools/image-limits';
import { cn } from '@/lib/utils';

type ColorPreset = 'gray' | 'red' | 'blue' | 'white';

interface WatermarkOptionsState {
  kind: ImageWatermarkKind;
  logoScale: number;
  outline: boolean;
  text: string;
  position: ImageWatermarkPosition;
  fontSize: number;
  opacity: number;
  colorKey: ColorPreset;
  rotation: number;
  outputType: ImageWatermarkOutputType;
  quality: number;
}

const COLOR_PRESETS: Record<ColorPreset, ImageWatermarkColor> = {
  gray: { r: 120, g: 120, b: 120 },
  red: { r: 190, g: 44, b: 44 },
  blue: { r: 42, g: 92, b: 190 },
  white: { r: 255, g: 255, b: 255 },
};

const FORMAT_LABELS: Record<ImageWatermarkOutputType, string> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
};

const FORMAT_MAP: Record<ImageWatermarkOutputType, string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function toProcessingOptions(
  state: WatermarkOptionsState,
  transform: NormalizedImageTransform,
  logo?: Blob | null
): ImageWatermarkOptions {
  return {
    kind: state.kind,
    logo,
    logoScale: state.logoScale,
    outline: state.outline,
    text: state.text.trim(),
    position: state.position,
    fontSize: state.fontSize,
    opacity: state.opacity,
    color: COLOR_PRESETS[state.colorKey],
    rotation: state.position === 'tile' ? state.rotation : 0,
    outputType: state.outputType,
    quality: state.quality,
    transform,
  };
}

async function processOnServer(
  file: File,
  config: Record<string, unknown>,
  uploadMutate: (file: File) => Promise<unknown>,
  createTaskMutate: (input: any) => Promise<{ id: string }>,
  outputType: ImageWatermarkOutputType
): Promise<File> {
  const uploaded = (await uploadMutate(file)) as { id: string };
  const task = await createTaskMutate({
    type: 'image_watermark',
    inputFileIds: [uploaded.id],
    inputConfig: config,
  });

  while (true) {
    const { data, error } = await api.GET('/tasks/{id}/status', {
      params: { path: { id: task.id } },
    });
    if (error) throw new Error('Failed to poll task status');
    if (data?.status === 'completed') {
      const outputFileId = (data as any).outputFileId as string;
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/files/${outputFileId}/download`,
        { credentials: 'include' }
      );
      if (!response.ok) throw new Error('Failed to download result');
      const blob = await response.blob();
      const ext =
        outputType === 'image/jpeg' ? 'jpg' : outputType.split('/')[1];
      const base = file.name.replace(/\.[^.]+$/, '');
      return new File([blob], `watermarked-${base}.${ext}`, {
        type: blob.type || outputType,
      });
    }
    if (data?.status === 'failed') {
      throw new Error((data as any).errorMessage ?? 'Task failed');
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}

export default function ImageWatermarkPage() {
  const t = useTranslations('ImageWatermark');
  const tShell = useTranslations('ToolShell');
  const tShared = useTranslations('ToolsShared');
  const tool = getToolByHref('/image/watermark')!;

  const [items, setItems] = useState<FileItem[]>([]);
  const [options, setOptions] = useState<WatermarkOptionsState>({
    text: '',
    kind: 'text',
    logoScale: DEFAULT_LOGO_SCALE,
    outline: false,
    position: 'tile',
    fontSize: 40,
    opacity: 0.28,
    colorKey: 'gray',
    rotation: -30,
    outputType: 'image/jpeg',
    quality: 90,
  });
  const [transform, setTransform] = useState(DEFAULT_IMAGE_TRANSFORM);
  const [mode, setMode] = useState<ProcessMode>('local');
  const [progress, setProgress] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const router = useRouter();
  const { data: session, isPending: sessionLoading } = authClient.useSession();
  // 这三个工具可能把图片发到服务端,因此受账号额度约束(纯本地工具不受)。
  const maxFileSize = getImageUploadMaxFileSize(session);
  const uploadFile = useUploadFile();
  const createTask = useCreateTask();

  const recommendation: ProcessMode =
    items.length > 0
      ? items.every(it => shouldProcessLocally(it.file))
        ? 'local'
        : 'server'
      : 'local';
  const [logoFile, setLogoFile] = useState<File | null>(null);
  // Logo 水印是纯画面合成,服务端任务只接受文字,选了 Logo 就必须留在本地。
  const logoNeedsLocal = options.kind === 'logo';
  const needsServerLogin = mode === 'server' && !sessionLoading && !session;
  const selectedColor = COLOR_PRESETS[options.colorKey];

  const handleDrop = (files: File[]) => {
    if (files.length === 0) return;
    setItems(prev => [
      ...prev,
      ...files.map(file => ({ file, status: 'pending' as const })),
    ]);
    setGlobalError(null);
    setProgress(0);
  };

  const handleRemove = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, patch: Partial<FileItem>) => {
    setItems(prev =>
      prev.map((it, i) => (i === index ? { ...it, ...patch } : it))
    );
  };

  const handleProcess = async () => {
    if (items.length === 0 || !options.text.trim()) return;

    if (mode === 'server' && logoNeedsLocal) {
      setGlobalError(t('logoLocalOnlyError'));
      return;
    }

    if (options.kind === 'logo' && !logoFile) {
      setGlobalError(t('logoRequiredError'));
      return;
    }

    if (mode === 'server' && !sessionLoading && !session) {
      const next = encodeURIComponent('/image/watermark');
      router.push(`/login?next=${next}`);
      return;
    }

    const indicesToProcess = items
      .map((it, i) => (it.status === 'done' && it.result ? -1 : i))
      .filter(i => i >= 0);
    if (indicesToProcess.length === 0) return;

    setProcessing(true);
    setGlobalError(null);
    setProgress(0);
    setItems(prev =>
      prev.map(it =>
        it.status === 'done' && it.result
          ? it
          : { file: it.file, status: 'pending' as const }
      )
    );

    const fileProgress: number[] = items.map(it =>
      it.status === 'done' && it.result ? 100 : 0
    );
    const updateOverall = () => {
      const sum = fileProgress.reduce((a, b) => a + b, 0);
      setProgress(Math.round(sum / items.length));
    };
    updateOverall();

    const processingOptions = toProcessingOptions(options, transform, logoFile);
    const tasks = indicesToProcess.map(async i => {
      const item = items[i]!;
      updateItem(i, { status: 'processing' });
      try {
        let result: File;
        if (mode === 'local') {
          fileProgress[i] = 25;
          updateOverall();
          result = await watermarkImage(item.file, processingOptions);
        } else {
          result = await processOnServer(
            item.file,
            {
              text: processingOptions.text,
              position: processingOptions.position,
              fontSize: processingOptions.fontSize,
              opacity: processingOptions.opacity,
              color: processingOptions.color,
              rotation: processingOptions.rotation,
              outline: processingOptions.outline,
              outputFormat: FORMAT_MAP[processingOptions.outputType],
              quality: processingOptions.quality,
              transform: toServerTransformConfig(transform),
            },
            f => uploadFile.mutateAsync(f),
            input => createTask.mutateAsync(input) as Promise<{ id: string }>,
            processingOptions.outputType
          );
        }
        fileProgress[i] = 100;
        updateOverall();
        updateItem(i, { result, status: 'done' });
      } catch (err) {
        const message = (err as Error).message;
        updateItem(i, { status: 'failed', error: message });
        fileProgress[i] = 100;
        updateOverall();
      }
    });

    await Promise.all(tasks);
    setProcessing(false);
  };

  const isSingle = items.length === 1;
  const singleItem = isSingle ? items[0] : null;
  const successResults = items
    .filter(it => it.status === 'done' && it.result)
    .map(it => it.result as File);
  const hasAnyResult = successResults.length > 0;
  const stage = hasAnyResult
    ? 'result'
    : processing
      ? 'processing'
      : items.length > 0
        ? 'configure'
        : 'upload';

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
        accept={{
          'image/*': [
            '.jpg',
            '.jpeg',
            '.png',
            '.webp',
            '.avif',
            '.heic',
            '.heif',
          ],
        }}
        maxSize={maxFileSize}
        multiple
        onDrop={handleDrop}
        disabled={processing}
        hint={t('dropzoneHint')}
        processingLabel={
          mode === 'local' ? tShared('mode.local') : tShared('mode.server')
        }
      />

      {items.length > 0 && (
        <div className="space-y-6">
          <FileList
            items={items}
            onRemove={handleRemove}
            disabled={processing}
          />

          <div className="grid gap-6 md:grid-cols-[1fr_280px]">
            <div className="space-y-5">
              <div className="space-y-2">
                <label
                  htmlFor="image-watermark-text"
                  className="text-xs font-mono text-muted-foreground uppercase tracking-wider"
                >
                  {t('text')}
                </label>
                <input
                  id="image-watermark-text"
                  type="text"
                  value={options.text}
                  onChange={e =>
                    setOptions({ ...options, text: e.target.value })
                  }
                  placeholder={t('textPlaceholder')}
                  disabled={processing}
                  className="h-9 w-full rounded-md border border-border bg-transparent px-3 text-sm font-mono focus:border-accent focus:outline-none disabled:opacity-50"
                />
              </div>

              <div className="space-y-2">
                <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                  {t('kind')}
                </div>
                <div className="inline-flex border border-border rounded-md p-0.5">
                  {(['text', 'logo'] as const).map(k => (
                    <button
                      key={k}
                      type="button"
                      disabled={processing}
                      onClick={() => setOptions({ ...options, kind: k })}
                      className={cn(
                        'h-8 px-3 text-xs font-mono transition-colors rounded-sm',
                        options.kind === k
                          ? 'bg-foreground text-background'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {t(`kinds.${k}`)}
                    </button>
                  ))}
                </div>
                {logoNeedsLocal && (
                  <p className="text-[10px] font-mono text-muted-foreground">
                    {t('logoLocalOnly')}
                  </p>
                )}
              </div>

              {options.kind === 'logo' && (
                <div className="space-y-2">
                  <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    {t('logo')}
                  </div>
                  <input
                    type="file"
                    accept="image/png,image/webp,image/svg+xml,image/jpeg"
                    disabled={processing}
                    onChange={e => setLogoFile(e.target.files?.[0] ?? null)}
                    className="w-full text-xs font-mono file:mr-3 file:h-8 file:rounded-md file:border file:border-border file:bg-transparent file:px-3 file:text-xs file:font-mono"
                  />
                  <label className="space-y-2 block">
                    <span className="flex items-center justify-between text-xs font-mono text-muted-foreground uppercase tracking-wider">
                      {t('logoScale')}
                      <span className="tabular-nums text-foreground">
                        {Math.round(options.logoScale * 100)}%
                      </span>
                    </span>
                    <input
                      type="range"
                      min={0.05}
                      max={1}
                      step={0.05}
                      value={options.logoScale}
                      disabled={processing}
                      onChange={e =>
                        setOptions({
                          ...options,
                          logoScale: Number(e.target.value),
                        })
                      }
                      className="w-full accent-accent"
                    />
                  </label>
                </div>
              )}

              <div className="space-y-2">
                <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                  {t('position')}
                </div>
                <div className="flex flex-wrap items-start gap-3">
                  {/* 九宫格:四角与边中点是最常见的诉求,此前只有中心与右下角 */}
                  <div className="grid grid-cols-3 gap-1">
                    {IMAGE_WATERMARK_GRID.map(pos => (
                      <button
                        key={pos}
                        type="button"
                        disabled={processing}
                        title={t(`positions.${pos}`)}
                        aria-label={t(`positions.${pos}`)}
                        onClick={() =>
                          setOptions({ ...options, position: pos })
                        }
                        className={cn(
                          'h-7 w-7 rounded-sm border transition-colors',
                          options.position === pos
                            ? 'border-foreground bg-foreground'
                            : 'border-border hover:border-foreground/40'
                        )}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    disabled={processing}
                    onClick={() => setOptions({ ...options, position: 'tile' })}
                    className={cn(
                      'h-8 rounded-md border px-3 text-xs font-mono transition-colors',
                      options.position === 'tile'
                        ? 'border-foreground bg-foreground text-background'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {t('positions.tile')}
                  </button>
                </div>
                <p className="text-[10px] font-mono text-muted-foreground">
                  {t(`positions.${options.position}`)}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2">
                  <span className="flex items-center justify-between text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    {t('fontSize')}
                    <span className="tabular-nums text-foreground">
                      {options.fontSize}px
                    </span>
                  </span>
                  <input
                    type="range"
                    min={12}
                    max={120}
                    step={1}
                    value={options.fontSize}
                    disabled={processing}
                    onChange={e =>
                      setOptions({
                        ...options,
                        fontSize: Number(e.target.value),
                      })
                    }
                    className="w-full accent-accent"
                  />
                </label>

                <label className="space-y-2">
                  <span className="flex items-center justify-between text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    {t('opacity')}
                    <span className="tabular-nums text-foreground">
                      {Math.round(options.opacity * 100)}%
                    </span>
                  </span>
                  <input
                    type="range"
                    min={0.05}
                    max={0.8}
                    step={0.05}
                    value={options.opacity}
                    disabled={processing}
                    onChange={e =>
                      setOptions({
                        ...options,
                        opacity: Number(e.target.value),
                      })
                    }
                    className="w-full accent-accent"
                  />
                </label>
              </div>

              {options.position === 'tile' && (
                <label className="block space-y-2">
                  <span className="flex items-center justify-between text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    {t('rotation')}
                    <span className="tabular-nums text-foreground">
                      {options.rotation}°
                    </span>
                  </span>
                  <input
                    type="range"
                    min={-60}
                    max={60}
                    step={5}
                    value={options.rotation}
                    disabled={processing}
                    onChange={e =>
                      setOptions({
                        ...options,
                        rotation: Number(e.target.value),
                      })
                    }
                    className="w-full accent-accent"
                  />
                </label>
              )}

              {options.kind === 'text' && (
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options.outline}
                    disabled={processing}
                    onChange={e =>
                      setOptions({ ...options, outline: e.target.checked })
                    }
                    className="mt-0.5 accent-accent"
                  />
                  <span className="space-y-0.5">
                    <span className="block text-xs font-mono">
                      {t('outline')}
                    </span>
                    <span className="block text-[10px] font-mono text-muted-foreground">
                      {t('outlineHint')}
                    </span>
                  </span>
                </label>
              )}

              <div className="space-y-2">
                <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                  {t('color')}
                </div>{' '}
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(COLOR_PRESETS) as ColorPreset[]).map(key => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setOptions({ ...options, colorKey: key })}
                      disabled={processing}
                      className={cn(
                        'flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-mono transition-colors',
                        options.colorKey === key
                          ? 'border-accent bg-accent/10 text-foreground'
                          : 'border-border text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <span
                        className="h-3 w-3 rounded-sm border border-border/60"
                        style={{
                          backgroundColor: colorToCss(COLOR_PRESETS[key], 1),
                        }}
                      />
                      {t(`colors.${key}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    {t('outputFormat')}
                  </div>
                  <div className="inline-flex border border-border rounded-md p-0.5">
                    {(
                      Object.keys(FORMAT_LABELS) as ImageWatermarkOutputType[]
                    ).map(fmt => (
                      <button
                        key={fmt}
                        type="button"
                        disabled={processing}
                        onClick={() =>
                          setOptions({ ...options, outputType: fmt })
                        }
                        className={cn(
                          'h-8 px-3 text-xs font-mono transition-colors rounded-sm',
                          options.outputType === fmt
                            ? 'bg-foreground text-background'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        {FORMAT_LABELS[fmt]}
                      </button>
                    ))}
                  </div>
                </div>

                {options.outputType !== 'image/png' && (
                  <label className="space-y-2">
                    <span className="flex items-center justify-between text-xs font-mono text-muted-foreground uppercase tracking-wider">
                      {t('quality')}
                      <span className="tabular-nums text-foreground">
                        {options.quality}%
                      </span>
                    </span>
                    <input
                      type="range"
                      min={1}
                      max={100}
                      value={options.quality}
                      disabled={processing}
                      onChange={e =>
                        setOptions({
                          ...options,
                          quality: Number(e.target.value),
                        })
                      }
                      className="w-full accent-accent"
                    />
                  </label>
                )}
              </div>
            </div>

            <div className="flex min-h-[180px] items-center justify-center rounded-md border border-border bg-muted/10 p-4">
              <div
                className="flex aspect-[4/3] w-full max-w-[220px] items-center justify-center overflow-hidden rounded-sm border border-border bg-background"
                style={{
                  color: colorToCss(selectedColor, options.opacity),
                }}
              >
                <span
                  className="select-none whitespace-nowrap font-bold"
                  style={{
                    fontSize: `${Math.max(12, options.fontSize * 0.45)}px`,
                    transform:
                      options.position === 'tile'
                        ? `rotate(${options.rotation}deg)`
                        : 'none',
                  }}
                >
                  {options.text || t('textPlaceholder')}
                </span>
              </div>
            </div>
          </div>

          <ImageTransformOptions
            value={transform}
            onChange={setTransform}
            disabled={processing}
          />

          <ModeToggle
            value={mode}
            onChange={setMode}
            recommendation={recommendation}
            disabled={processing}
            serverLoginRequired={needsServerLogin}
          />

          <button
            type="button"
            onClick={handleProcess}
            disabled={processing || !options.text.trim()}
            className="h-10 w-full rounded-md bg-foreground text-sm font-mono text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {processing
              ? t('processing')
              : needsServerLogin
                ? tShared('mode.loginToUseServer')
                : items.length > 1
                  ? t('startWithCount', { count: items.length })
                  : t('start')}
          </button>
        </div>
      )}

      {processing && (
        <ProcessingProgress progress={progress} stage="processing" />
      )}

      {globalError && (
        <FailureRecoveryPanel
          message={globalError}
          onRetry={handleProcess}
          onReset={() => {
            setItems([]);
            setGlobalError(null);
            setProgress(0);
          }}
        />
      )}

      {hasAnyResult && (
        <div className="space-y-6">
          {isSingle && singleItem?.result && (
            <ImageCompare
              original={singleItem.file}
              result={singleItem.result}
            />
          )}

          <ResultPanel
            title={
              successResults.length === 1
                ? successResults[0]!.name
                : `watermarked-${successResults.length}-files.zip`
            }
            description={
              successResults.length === 1
                ? tShell('result.ready')
                : tShell('result.filesReady', { count: successResults.length })
            }
            action={
              successResults.length === 1 ? (
                <DownloadButton file={successResults[0]!} />
              ) : (
                <ZipDownloadButton
                  files={successResults}
                  zipName={`watermarked-${successResults.length}-files.zip`}
                />
              )
            }
          />
        </div>
      )}
    </ToolPageShell>
  );
}
