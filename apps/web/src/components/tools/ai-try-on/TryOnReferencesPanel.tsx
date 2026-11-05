'use client';

import { useTranslations } from 'next-intl';
import { UploadReferenceCard } from './UploadReferenceCard';
import { ReferenceLibraryGrid } from './ReferenceLibraryGrid';
import { GarmentLibraryGrid } from './GarmentLibraryGrid';
import { TryOnCompositionStrip } from './TryOnCompositionStrip';
import type { TryOnWorkbench } from './useTryOnWorkbench';

type TryOnReferencesPanelProps = Pick<
  TryOnWorkbench,
  | 'form'
  | 'task'
  | 'libraries'
  | 'maxFileSize'
  | 'selectedPersonAsset'
  | 'selectedGarmentAsset'
  | 'selectedPoseAsset'
  | 'selectedStyleAsset'
  | 'handleFallbackToUpload'
>;

export function TryOnReferencesPanel({
  form,
  task,
  libraries,
  maxFileSize,
  selectedPersonAsset,
  selectedGarmentAsset,
  selectedPoseAsset,
  selectedStyleAsset,
  handleFallbackToUpload,
}: TryOnReferencesPanelProps) {
  const t = useTranslations('ImageTryOn');
  const {
    mode,
    personSource,
    setPersonSource,
    personFile,
    setPersonFile,
    personAssetId,
    setPersonAssetId,
    garmentFile,
    setGarmentFile,
    garmentAssetId,
    setGarmentAssetId,
    poseAssetId,
    setPoseAssetId,
    styleAssetId,
    setStyleAssetId,
  } = form;
  const { isBusy, setError, handleReset } = task;
  const {
    person: personLibraryQuery,
    garment: garmentLibraryQuery,
    pose: poseLibraryQuery,
  } = libraries;
  return (
    <>
      {/* 4 大要素配置区域（2x2 网格） */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 1. 人像参考（必选） */}
        <section
          id="try-on-section-person"
          className="space-y-3 rounded-xl border border-border bg-card p-4 transition-all"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-medium">{t('personSectionTitle')}</h2>
              <p className="text-xs text-muted-foreground">
                {t('personSectionHint')}
              </p>
            </div>
            <div className="flex rounded-md border border-border overflow-hidden">
              <button
                type="button"
                aria-pressed={personSource === 'upload'}
                data-testid="person-source-upload"
                disabled={isBusy}
                onClick={() => {
                  setPersonSource('upload');
                  setError(null);
                }}
                className={`px-3 py-1.5 font-mono text-xs transition-colors ${
                  personSource === 'upload'
                    ? 'bg-foreground text-background font-medium'
                    : 'bg-background text-muted-foreground hover:text-foreground'
                }`}
              >
                {t('personSourceUpload')}
              </button>
              <button
                type="button"
                aria-pressed={personSource === 'library'}
                data-testid="person-source-library"
                disabled={isBusy}
                onClick={() => {
                  setPersonSource('library');
                  setError(null);
                }}
                className={`px-3 py-1.5 font-mono text-xs transition-colors ${
                  personSource === 'library'
                    ? 'bg-foreground text-background font-medium'
                    : 'bg-background text-muted-foreground hover:text-foreground'
                }`}
              >
                {t('personSourceLibrary')}
              </button>
            </div>
          </div>

          {personSource === 'upload' ? (
            <UploadReferenceCard
              role="person"
              file={personFile}
              actionLabel={t('personUploadAction')}
              maxFileSize={maxFileSize}
              disabled={isBusy}
              onFileChange={file => {
                setPersonFile(file);
                setError(null);
              }}
              onOversizeError={maxSizeFormatted =>
                setError(t('errors.fileTooLarge', { size: maxSizeFormatted }))
              }
            />
          ) : (
            <ReferenceLibraryGrid
              role="person"
              showQuickPicks
              items={personLibraryQuery.data ?? []}
              selectedId={personAssetId}
              onSelect={id => {
                setPersonAssetId(id);
                setError(null);
              }}
              isLoading={personLibraryQuery.isLoading}
              isError={personLibraryQuery.isError}
              onRetry={() => void personLibraryQuery.refetch?.()}
              onFallbackToUpload={handleFallbackToUpload}
              disabled={isBusy}
            />
          )}
        </section>

        {/* 2. 目标服装参考（必选） */}
        <section
          id="try-on-section-garment"
          className="space-y-3 rounded-xl border border-border bg-card p-4 transition-all"
        >
          <div>
            <h2 className="text-sm font-medium">
              {mode === 'product'
                ? t('garmentProductSectionTitle')
                : t('garmentInspirationSectionTitle')}
            </h2>
            <p className="text-xs text-muted-foreground">
              {mode === 'product'
                ? t('garmentProductSectionHint')
                : t('garmentInspirationSectionHint')}
            </p>
          </div>

          {mode === 'product' ? (
            <UploadReferenceCard
              role="garment"
              file={garmentFile}
              actionLabel={t('garmentUploadAction')}
              maxFileSize={maxFileSize}
              disabled={isBusy}
              onFileChange={file => {
                setGarmentFile(file);
                setError(null);
              }}
              onOversizeError={maxSizeFormatted =>
                setError(t('errors.fileTooLarge', { size: maxSizeFormatted }))
              }
            />
          ) : (
            <GarmentLibraryGrid
              role="garment"
              items={garmentLibraryQuery.data ?? []}
              selectedId={garmentAssetId}
              onSelect={id => {
                setGarmentAssetId(id);
                setError(null);
              }}
              isLoading={garmentLibraryQuery.isLoading}
              isError={garmentLibraryQuery.isError}
              onRetry={() => void garmentLibraryQuery.refetch?.()}
              onFallbackToUpload={handleFallbackToUpload}
              disabled={isBusy}
            />
          )}
        </section>

        {/* 3. 姿势参考（可选） */}
        <section
          id="try-on-section-pose"
          className="space-y-3 rounded-xl border border-border bg-card p-4 transition-all"
        >
          <div>
            <h2 className="text-sm font-medium">{t('poseSectionTitle')}</h2>
            <p className="text-xs text-muted-foreground">
              {t('poseSectionHint')}
            </p>
          </div>

          <ReferenceLibraryGrid
            role="pose"
            showQuickPicks
            items={poseLibraryQuery.data ?? []}
            selectedId={poseAssetId}
            onSelect={id => {
              setPoseAssetId(id);
              setError(null);
            }}
            isLoading={poseLibraryQuery.isLoading}
            isError={poseLibraryQuery.isError}
            onRetry={() => void poseLibraryQuery.refetch?.()}
            disabled={isBusy}
            optional
          />
        </section>

        {/* 4. 辅助穿搭风格（可选 · 弱优先级） */}
        <section
          id="try-on-section-style"
          className="space-y-3 rounded-xl border border-border bg-card p-4 transition-all"
        >
          <div>
            <h2 className="text-sm font-medium">{t('styleSectionTitle')}</h2>
            <p className="text-xs text-muted-foreground">
              {t('styleSectionHint')}
            </p>
          </div>

          <ReferenceLibraryGrid
            role="style"
            items={garmentLibraryQuery.data ?? []}
            selectedId={styleAssetId}
            onSelect={id => {
              setStyleAssetId(id);
              setError(null);
            }}
            isLoading={garmentLibraryQuery.isLoading}
            isError={garmentLibraryQuery.isError}
            onRetry={() => void garmentLibraryQuery.refetch?.()}
            disabled={isBusy}
            optional
          />
        </section>
      </div>

      {/* 穿搭搭配即时看板（总览与快速检查） */}
      <TryOnCompositionStrip
        personFile={personFile}
        personAsset={selectedPersonAsset}
        onClearPerson={() => {
          setPersonFile(null);
          setPersonAssetId(null);
        }}
        garmentFile={garmentFile}
        garmentAsset={selectedGarmentAsset}
        onClearGarment={() => {
          setGarmentFile(null);
          setGarmentAssetId(null);
        }}
        poseAsset={selectedPoseAsset}
        onClearPose={() => setPoseAssetId(null)}
        styleAsset={selectedStyleAsset}
        onClearStyle={() => setStyleAssetId(null)}
        onResetAll={handleReset}
        disabled={isBusy}
      />
    </>
  );
}
