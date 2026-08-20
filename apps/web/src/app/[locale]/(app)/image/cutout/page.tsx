'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { formatBytes } from '@/lib/format';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { FailureRecoveryPanel } from '@/components/tools/failure-recovery-panel';
import { ProcessingProgress } from '@/components/tools/processing-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { ToolPageShell } from '@/components/tools/tool-page-shell';
import type { ToolStage } from '@/components/tools/tool-step-rail';
import { DownloadButton } from '@/components/tools/download-button';
import { getToolByHref } from '@/lib/tools/tool-metadata';
import { useObjectUrl } from '@/hooks/use-object-url';
import { useLocalCutout } from '@/lib/cutout/use-local-cutout';
import {
  cutoutSelectionIsValid,
  getCutoutFileName,
  supportsTransparency,
  type CutoutBackground,
  type CutoutOutputType,
} from '@/lib/cutout/composite';
import { cn } from '@/lib/utils';

const BACKGROUND_PRESETS: { key: string; color: string }[] = [
  { key: 'white', color: '#ffffff' },
  { key: 'black', color: '#000000' },
  { key: 'blue', color: '#438edb' },
  { key: 'red', color: '#d82727' },
  { key: 'green', color: '#2f9e5f' },
];

const OUTPUT_TYPES: CutoutOutputType[] = [
  'image/png',
  'image/webp',
  'image/jpeg',
];

const FORMAT_LABELS: Record<CutoutOutputType, string> = {
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'image/jpeg': 'JPEG',
};

export default function CutoutPage() {
  const t = useTranslations('ImageCutout');
  const tShell = useTranslations('ToolShell');
  const tUnits = useTranslations('Common.units');
  const locale = useLocale();
  const tool = getToolByHref('/image/cutout')!;

  const [file, setFile] = useState<File | null>(null);
  const [background, setBackground] = useState<CutoutBackground>({
    kind: 'transparent',
  });
  const [outputType, setOutputType] = useState<CutoutOutputType>('image/png');
  const [highPrecision, setHighPrecision] = useState(false);

  const local = useLocalCutout();
  const sourceUrl = useObjectUrl(file);
  const resultUrl = useObjectUrl(local.resultBlob);

  const processing =
    local.status === 'loading-model' ||
    local.status === 'running' ||
    local.status === 'compositing';
  // 透明 + JPEG 会被 canvas 压成黑底,必须拦下并说明,而不是默默填白。
  const selectionValid = cutoutSelectionIsValid(background, outputType);

  const handleDrop = (files: File[]) => {
    if (!files[0]) return;
    setFile(files[0]);
    local.reset();
  };

  const handleProcess = async () => {
    if (!file || !selectionValid) return;
    await local.process(file, highPrecision ? 'high' : 'balanced', {
      background,
      outputType,
    });
  };

  const resultFile = local.resultBlob
    ? new File(
        [local.resultBlob],
        getCutoutFileName(file?.name ?? 'image', outputType),
        { type: outputType }
      )
    : null;

  const stage: ToolStage = resultFile
    ? 'result'
    : processing
      ? 'processing'
      : file
        ? 'configure'
        : 'upload';

  const stageLabel =
    local.status === 'loading-model'
      ? t('stages.loadingModel')
      : local.status === 'running'
        ? t('stages.running')
        : t('stages.compositing');

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

      {file && (
        <div className="space-y-6">
          {sourceUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={sourceUrl}
              alt={t('sourceAlt')}
              className="mx-auto max-h-64 w-auto rounded-md border border-border object-contain"
            />
          )}

          <div className="text-xs font-mono text-muted-foreground">
            {t('selected', {
              filename: file.name,
              size: formatBytes(file.size, tUnits, locale),
            })}
          </div>

          <div className="space-y-2">
            <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              {t('background')}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={processing}
                onClick={() => setBackground({ kind: 'transparent' })}
                className={cn(
                  'h-9 rounded-md border px-3 text-xs font-mono transition-colors',
                  background.kind === 'transparent'
                    ? 'border-foreground bg-muted'
                    : 'border-border text-muted-foreground hover:text-foreground'
                )}
              >
                {t('backgrounds.transparent')}
              </button>
              {BACKGROUND_PRESETS.map(preset => (
                <button
                  key={preset.key}
                  type="button"
                  disabled={processing}
                  onClick={() =>
                    setBackground({ kind: 'color', color: preset.color })
                  }
                  className={cn(
                    'flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-mono transition-colors',
                    background.kind === 'color' &&
                      background.color === preset.color
                      ? 'border-foreground bg-muted'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  )}
                >
                  <span
                    className="h-3 w-3 rounded-sm border border-border/60"
                    style={{ backgroundColor: preset.color }}
                  />
                  {t(`backgrounds.${preset.key}`)}
                </button>
              ))}
            </div>
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
            {!supportsTransparency(outputType) && (
              <p className="text-[10px] font-mono text-muted-foreground">
                {t('formatNoAlpha', { format: FORMAT_LABELS[outputType] })}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-mono">
              <input
                type="checkbox"
                checked={highPrecision}
                disabled={processing || local.ep !== 'webgpu'}
                onChange={e => setHighPrecision(e.target.checked)}
                className="accent-accent"
              />
              <span>{t('highPrecision')}</span>
            </label>
            {local.ep !== 'webgpu' && (
              <p className="text-[10px] font-mono text-muted-foreground">
                {t('highPrecisionLocked')}
              </p>
            )}
          </div>

          {!selectionValid && (
            <p className="text-xs text-destructive font-mono">
              {t('transparentNeedsAlpha')}
            </p>
          )}

          <button
            type="button"
            onClick={handleProcess}
            disabled={processing || !selectionValid}
            className="h-10 w-full rounded-md bg-foreground text-sm font-mono text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {processing ? stageLabel : t('start')}
          </button>
        </div>
      )}

      {processing && (
        <ProcessingProgress
          progress={
            local.status === 'loading-model'
              ? Math.round(local.progress * 100)
              : local.status === 'running'
                ? 60
                : 90
          }
          label={stageLabel}
        />
      )}

      {local.error && (
        <FailureRecoveryPanel
          message={t('failed')}
          onRetry={handleProcess}
          onReset={() => {
            setFile(null);
            local.reset();
          }}
        />
      )}

      {resultFile && (
        <ResultPanel
          title={t('resultTitle')}
          description={resultFile.name}
          preview={
            resultUrl ? (
              // 棋盘格底,让透明区域一眼可辨
              <div
                className="mx-auto max-h-80 w-fit rounded-md border border-border p-2"
                style={{
                  backgroundImage:
                    'linear-gradient(45deg, #e5e5e5 25%, transparent 25%), linear-gradient(-45deg, #e5e5e5 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e5e5 75%), linear-gradient(-45deg, transparent 75%, #e5e5e5 75%)',
                  backgroundSize: '16px 16px',
                  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={resultUrl}
                  alt={t('resultAlt')}
                  className="max-h-72 w-auto object-contain"
                />
              </div>
            ) : null
          }
          meta={[
            {
              label: t('resultSize'),
              value: formatBytes(resultFile.size, tUnits, locale),
            },
          ]}
          action={<DownloadButton file={resultFile} />}
        />
      )}
    </ToolPageShell>
  );
}
