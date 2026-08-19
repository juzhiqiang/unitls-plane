'use client';

import { useState } from 'react';
import { DownloadButton } from '@/components/tools/download-button';
import { useObjectUrl } from '@/hooks/use-object-url';
import {
  buildIdPhotoSheetLayout,
  getSheetFileName,
  ID_PHOTO_SHEETS,
  renderIdPhotoSheet,
  SHEET_ORDER,
  type SheetKey,
} from '@/lib/id-photo/sheet';

export interface IdPhotoSheetPanelProps {
  /** 成品证件照(已换底、已裁剪)。 */
  photo: Blob;
  photoWidthPx: number;
  photoHeightPx: number;
  outputType: 'image/jpeg' | 'image/png';
  t: (key: string, values?: Record<string, string | number>) => string;
}

/**
 * 相纸拼版面板。
 *
 * 冲印按张计费,单张证件照去冲印是浪费。这里把成品照拼满一张相纸并画出裁切线,
 * 全程本地 canvas,不需要再上传。
 */
export function IdPhotoSheetPanel({
  photo,
  photoWidthPx,
  photoHeightPx,
  outputType,
  t,
}: IdPhotoSheetPanelProps) {
  const [sheet, setSheet] = useState<SheetKey>('six_inch');
  const [cutMarks, setCutMarks] = useState(true);
  const [result, setResult] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resultUrl = useObjectUrl(result);

  const layout = buildIdPhotoSheetLayout(
    ID_PHOTO_SHEETS[sheet],
    photoWidthPx,
    photoHeightPx
  );

  const handleRender = async () => {
    setBusy(true);
    setError(null);
    try {
      const blob = await renderIdPhotoSheet(photo, layout, {
        cutMarks,
        outputType,
      });
      setResult(
        new File([blob], getSheetFileName(sheet, outputType), {
          type: outputType,
        })
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 rounded-md border border-border p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{t('sheetTitle')}</h3>
        <p className="text-xs text-muted-foreground">{t('sheetDescription')}</p>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-mono text-muted-foreground">
          {t('sheetSize')}
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          {SHEET_ORDER.map(key => {
            const spec = ID_PHOTO_SHEETS[key];
            const capacity = buildIdPhotoSheetLayout(
              spec,
              photoWidthPx,
              photoHeightPx
            ).capacity;
            return (
              <button
                key={key}
                type="button"
                disabled={busy || capacity === 0}
                onClick={() => {
                  setSheet(key);
                  setResult(null);
                }}
                className={`rounded-md border px-3 py-2 text-left text-sm disabled:opacity-40 ${
                  sheet === key ? 'border-foreground bg-muted' : 'border-border'
                }`}
              >
                <span className="block font-medium">{t(`sheets.${key}`)}</span>
                <span className="text-xs text-muted-foreground">
                  {spec.widthMm}×{spec.heightMm}mm ·{' '}
                  {capacity === 0
                    ? t('sheetTooSmall')
                    : t('sheetCapacity', { count: capacity })}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={cutMarks}
          disabled={busy}
          onChange={event => {
            setCutMarks(event.target.checked);
            setResult(null);
          }}
          className="accent-accent"
        />
        <span>{t('sheetCutMarks')}</span>
      </label>

      <button
        type="button"
        onClick={handleRender}
        disabled={busy || layout.capacity === 0}
        className="h-10 w-full rounded-md bg-foreground text-sm font-mono text-background transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? t('sheetRendering') : t('sheetStart')}
      </button>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {result && (
        <div className="space-y-3">
          {resultUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={resultUrl}
              alt={t('sheetPreviewAlt')}
              className="mx-auto max-h-96 w-auto rounded-md border border-border object-contain"
            />
          )}
          <DownloadButton file={result} />
        </div>
      )}
    </div>
  );
}
