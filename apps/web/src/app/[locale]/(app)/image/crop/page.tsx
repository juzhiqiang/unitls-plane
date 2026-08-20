'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { formatBytes } from '@/lib/format';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { FailureRecoveryPanel } from '@/components/tools/failure-recovery-panel';
import { ResultPanel } from '@/components/tools/result-panel';
import { ToolPageShell } from '@/components/tools/tool-page-shell';
import type { ToolStage } from '@/components/tools/tool-step-rail';
import { DownloadButton } from '@/components/tools/download-button';
import { ImageCropField } from '@/components/tools/image-crop-field';
import { getToolByHref } from '@/lib/tools/tool-metadata';
import { useObjectUrl } from '@/hooks/use-object-url';
import { useImageEncodingSupport } from '@/hooks/use-image-encoding-support';
import {
  centeredCropRect,
  CROP_ASPECTS,
  type CropRect,
} from '@/lib/crop/geometry';
import {
  getCropFileName,
  renderCrop,
  type CropOutputType,
} from '@/lib/crop/render';
import { cn } from '@/lib/utils';

const OUTPUT_TYPES: CropOutputType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
];

const FORMAT_LABELS: Record<CropOutputType, string> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'image/avif': 'AVIF',
};

export default function CropPage() {
  const t = useTranslations('ImageCrop');
  const tShell = useTranslations('ToolShell');
  const tUnits = useTranslations('Common.units');
  const locale = useLocale();
  const tool = getToolByHref('/image/crop')!;

  const [file, setFile] = useState<File | null>(null);
  const [natural, setNatural] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [rect, setRect] = useState<CropRect | null>(null);
  const [aspectKey, setAspectKey] = useState('free');
  const [outputType, setOutputType] = useState<CropOutputType>('image/jpeg');
  const [quality, setQuality] = useState(92);
  const [resizeEnabled, setResizeEnabled] = useState(false);
  const [resizeWidth, setResizeWidth] = useState(1920);
  const [result, setResult] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceUrl = useObjectUrl(file);
  const resultUrl = useObjectUrl(result);
  const locallyEncodable = useImageEncodingSupport(OUTPUT_TYPES);
  const formatUnavailable = !locallyEncodable.has(outputType);

  const aspect =
    CROP_ASPECTS.find(item => item.key === aspectKey)?.value ?? null;
  // 输出高度由裁剪框比例反推,用户只需要给宽度。
  const outputHeight =
    rect && resizeEnabled
      ? Math.max(1, Math.round((resizeWidth / rect.width) * rect.height))
      : null;

  const handleDrop = (files: File[]) => {
    if (!files[0]) return;
    setFile(files[0]);
    setNatural(null);
    setRect(null);
    setResult(null);
    setError(null);
  };

  const applyAspect = (key: string) => {
    setAspectKey(key);
    const next = CROP_ASPECTS.find(item => item.key === key)?.value ?? null;
    if (natural) setRect(centeredCropRect(natural, next));
  };

  const handleProcess = async () => {
    if (!file || !rect) return;
    if (formatUnavailable) {
      setError(t('formatUnavailable', { format: FORMAT_LABELS[outputType] }));
      return;
    }

    setProcessing(true);
    setError(null);
    try {
      const blob = await renderCrop(file, {
        rect,
        outputType,
        quality: quality / 100,
        resize:
          resizeEnabled && outputHeight
            ? { width: resizeWidth, height: outputHeight }
            : null,
      });
      setResult(
        new File([blob], getCropFileName(file.name, outputType), {
          type: outputType,
        })
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProcessing(false);
    }
  };

  const stage: ToolStage = result
    ? 'result'
    : processing
      ? 'processing'
      : file
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
        maxSize={50 * 1024 * 1024}
        onDrop={handleDrop}
        disabled={processing}
        hint={t('dropzoneHint')}
        processingLabel={t('processingLabel')}
      />

      {file && sourceUrl && (
        <div className="space-y-6">
          <ImageCropField
            imageUrl={sourceUrl}
            natural={natural}
            onNatural={setNatural}
            value={rect}
            onChange={setRect}
            aspect={aspect}
            disabled={processing}
            t={t}
          />

          <div className="text-xs font-mono text-muted-foreground">
            {t('selected', {
              filename: file.name,
              size: formatBytes(file.size, tUnits, locale),
            })}
          </div>

          <div className="space-y-2">
            <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              {t('aspect')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CROP_ASPECTS.map(item => (
                <button
                  key={item.key}
                  type="button"
                  disabled={processing}
                  onClick={() => applyAspect(item.key)}
                  className={cn(
                    'h-8 rounded-md border px-3 text-xs font-mono transition-colors',
                    aspectKey === item.key
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t(`aspects.${item.key}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-mono">
              <input
                type="checkbox"
                checked={resizeEnabled}
                disabled={processing}
                onChange={e => setResizeEnabled(e.target.checked)}
                className="accent-accent"
              />
              <span>{t('resize')}</span>
            </label>
            {resizeEnabled && (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={12000}
                  value={resizeWidth}
                  disabled={processing}
                  onChange={e => setResizeWidth(Number(e.target.value) || 1)}
                  className="h-9 w-32 rounded-md border border-border bg-transparent px-3 text-sm font-mono tabular-nums focus:border-accent focus:outline-none"
                />
                <span className="text-xs font-mono text-muted-foreground tabular-nums">
                  × {outputHeight ?? '—'} px
                </span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              {t('outputFormat')}
            </div>
            <div className="inline-flex rounded-md border border-border p-0.5">
              {OUTPUT_TYPES.map(type => (
                <button
                  key={type}
                  type="button"
                  disabled={processing}
                  onClick={() => setOutputType(type)}
                  className={cn(
                    'h-8 rounded-sm px-3 text-xs font-mono transition-colors',
                    outputType === type
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {FORMAT_LABELS[type]}
                </button>
              ))}
            </div>
            {formatUnavailable && (
              <p className="text-[10px] font-mono text-muted-foreground">
                {t('formatUnavailable', {
                  format: FORMAT_LABELS[outputType],
                })}
              </p>
            )}
          </div>

          {outputType !== 'image/png' && (
            <label className="block space-y-2">
              <span className="flex items-center justify-between text-xs font-mono text-muted-foreground uppercase tracking-wider">
                {t('quality')}
                <span className="tabular-nums text-foreground">{quality}%</span>
              </span>
              <input
                type="range"
                min={1}
                max={100}
                value={quality}
                disabled={processing}
                onChange={e => setQuality(Number(e.target.value))}
                className="w-full accent-accent"
              />
            </label>
          )}

          <button
            type="button"
            onClick={handleProcess}
            disabled={processing || !rect || formatUnavailable}
            className="h-10 w-full rounded-md bg-foreground text-sm font-mono text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {processing ? t('processing') : t('start')}
          </button>
        </div>
      )}

      {error && (
        <FailureRecoveryPanel
          message={error}
          onRetry={handleProcess}
          onReset={() => {
            setFile(null);
            setRect(null);
            setResult(null);
            setError(null);
          }}
        />
      )}

      {result && (
        <ResultPanel
          title={t('resultTitle')}
          description={result.name}
          preview={
            resultUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={resultUrl}
                alt={t('resultAlt')}
                className="mx-auto max-h-80 w-auto rounded-md border border-border object-contain"
              />
            ) : null
          }
          meta={[
            {
              label: t('resultSize'),
              value: formatBytes(result.size, tUnits, locale),
            },
          ]}
          action={<DownloadButton file={result} />}
        />
      )}
    </ToolPageShell>
  );
}
