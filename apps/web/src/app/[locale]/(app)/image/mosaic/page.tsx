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
import { MosaicRegionField } from '@/components/tools/mosaic-region-field';
import { getToolByHref } from '@/lib/tools/tool-metadata';
import { useObjectUrl } from '@/hooks/use-object-url';
import {
  DEFAULT_STRENGTH,
  getMosaicFileName,
  MAX_STRENGTH,
  MIN_STRENGTH,
  MOSAIC_MODES,
  type MosaicMode,
  type MosaicRegion,
} from '@/lib/mosaic/geometry';
import { renderMosaic, type MosaicOutputType } from '@/lib/mosaic/render';
import { cn } from '@/lib/utils';

const OUTPUT_TYPES: MosaicOutputType[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
];

const FORMAT_LABELS: Record<MosaicOutputType, string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
};

export default function MosaicPage() {
  const t = useTranslations('ImageMosaic');
  const tShell = useTranslations('ToolShell');
  const tUnits = useTranslations('Common.units');
  const locale = useLocale();
  const tool = getToolByHref('/image/mosaic')!;

  const [file, setFile] = useState<File | null>(null);
  const [natural, setNatural] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [regions, setRegions] = useState<MosaicRegion[]>([]);
  const [mode, setMode] = useState<MosaicMode>('pixelate');
  const [strength, setStrength] = useState(DEFAULT_STRENGTH);
  const [outputType, setOutputType] = useState<MosaicOutputType>('image/png');
  const [result, setResult] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceUrl = useObjectUrl(file);
  const resultUrl = useObjectUrl(result);

  const handleDrop = (files: File[]) => {
    if (!files[0]) return;
    setFile(files[0]);
    setNatural(null);
    setRegions([]);
    setResult(null);
    setError(null);
  };

  const handleProcess = async () => {
    if (!file || regions.length === 0) return;
    setProcessing(true);
    setError(null);
    try {
      const blob = await renderMosaic(file, {
        regions,
        mode,
        strength,
        outputType,
      });
      setResult(
        new File([blob], getMosaicFileName(file.name, outputType), {
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
          <MosaicRegionField
            imageUrl={sourceUrl}
            natural={natural}
            onNatural={setNatural}
            regions={regions}
            onChange={setRegions}
            disabled={processing}
            t={t}
          />

          <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
            <span>
              {t('selected', {
                filename: file.name,
                size: formatBytes(file.size, tUnits, locale),
              })}
            </span>
            {regions.length > 0 && (
              <button
                type="button"
                disabled={processing}
                onClick={() => setRegions([])}
                className="hover:text-foreground"
              >
                {t('clearRegions')}
              </button>
            )}
          </div>

          <div className="space-y-2">
            <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              {t('mode')}
            </div>
            <div className="inline-flex rounded-md border border-border p-0.5">
              {MOSAIC_MODES.map(item => (
                <button
                  key={item}
                  type="button"
                  disabled={processing}
                  onClick={() => setMode(item)}
                  className={cn(
                    'h-8 rounded-sm px-3 text-xs font-mono transition-colors',
                    mode === item
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t(`modes.${item}`)}
                </button>
              ))}
            </div>
          </div>

          {mode !== 'solid' && (
            <label className="block space-y-2">
              <span className="flex items-center justify-between text-xs font-mono text-muted-foreground uppercase tracking-wider">
                {t('strength')}
                <span className="tabular-nums text-foreground">{strength}</span>
              </span>
              <input
                type="range"
                min={MIN_STRENGTH}
                max={MAX_STRENGTH}
                value={strength}
                disabled={processing}
                onChange={e => setStrength(Number(e.target.value))}
                className="w-full accent-accent"
              />
            </label>
          )}

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
          </div>

          <button
            type="button"
            onClick={handleProcess}
            disabled={processing || regions.length === 0}
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
            setRegions([]);
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
