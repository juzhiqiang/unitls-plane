'use client';

import { useTranslations } from 'next-intl';
import type {
  AiTryOnReferenceAssetDto,
  AiTryOnReferenceRole,
} from '@/hooks/api/types';

interface ReferenceLibraryGridProps {
  role: AiTryOnReferenceRole;
  items: AiTryOnReferenceAssetDto[];
  selectedId: string | null;
  onSelect: (assetId: string | null) => void;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  onFallbackToUpload?: () => void;
  disabled?: boolean;
  optional?: boolean;
}

export function ReferenceLibraryGrid({
  role,
  items,
  selectedId,
  onSelect,
  isLoading = false,
  isError = false,
  onRetry,
  onFallbackToUpload,
  disabled = false,
  optional = false,
}: ReferenceLibraryGridProps) {
  const t = useTranslations('ImageTryOn');

  if (isLoading) {
    return (
      <div
        role="status"
        data-testid={`library-loading-${role}`}
        className="rounded-md border border-border bg-muted/20 px-4 py-6 text-center text-xs font-mono text-muted-foreground"
      >
        {t('libraryLoading')}
      </div>
    );
  }

  if (isError) {
    return (
      <div
        role="alert"
        data-testid={`library-error-${role}`}
        className="space-y-3 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-xs"
      >
        <p className="text-foreground">{t('libraryError')}</p>
        {onFallbackToUpload && (
          <p className="text-muted-foreground">{t('fallbackToUploadHint')}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {onRetry && (
            <button
              type="button"
              disabled={disabled}
              onClick={onRetry}
              className="rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs text-foreground hover:border-foreground disabled:opacity-50"
            >
              {t('libraryRetry')}
            </button>
          )}
          {onFallbackToUpload && (
            <button
              type="button"
              disabled={disabled}
              onClick={onFallbackToUpload}
              className="rounded-md bg-foreground px-3 py-1.5 font-mono text-xs text-background hover:opacity-90 disabled:opacity-50"
            >
              {t('fallbackToUploadAction')}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div
        data-testid={`library-empty-${role}`}
        className="space-y-3 rounded-md border border-dashed border-border bg-muted/10 p-4 text-xs"
      >
        <p className="text-muted-foreground">{t('libraryEmpty')}</p>
        {onFallbackToUpload && (
          <>
            <p className="text-muted-foreground">{t('fallbackToUploadHint')}</p>
            <button
              type="button"
              disabled={disabled}
              onClick={onFallbackToUpload}
              className="rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs text-foreground hover:border-foreground disabled:opacity-50"
            >
              {t('fallbackToUploadAction')}
            </button>
          </>
        )}
      </div>
    );
  }

  const selectedAsset = items.find(item => item.id === selectedId);

  return (
    <div className="space-y-2.5">
      {selectedAsset && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{t('selectedAsset', { title: selectedAsset.title })}</span>
          {optional && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSelect(null)}
              className="font-mono text-xs underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
            >
              {t('clearSelection')}
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(item => {
          const isSelected = selectedId === item.id;
          return (
            <div
              key={item.id}
              data-testid={`library-card-${role}-${item.id}`}
              className={`flex flex-col justify-between rounded-md border p-3 transition-colors ${
                isSelected
                  ? 'border-foreground bg-muted/40'
                  : 'border-border bg-card hover:border-foreground/60'
              }`}
            >
              <button
                type="button"
                aria-pressed={isSelected}
                data-testid={`library-item-${role}-${item.id}`}
                disabled={disabled}
                onClick={() =>
                  onSelect(optional && isSelected ? null : item.id)
                }
                className="flex flex-col items-start gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
              >
                {item.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.thumbnailUrl}
                    alt={item.title}
                    loading="lazy"
                    className="h-32 w-full rounded border border-border object-cover"
                  />
                ) : null}
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    {item.title}
                  </p>
                  {item.description ? (
                    <p className="text-xs text-muted-foreground">
                      {item.description}
                    </p>
                  ) : null}
                </div>
                {item.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {item.tags.map(tag => (
                      <span
                        key={tag}
                        className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </button>

              <div className="mt-2 border-t border-border/60 pt-2 text-[11px] text-muted-foreground space-y-0.5">
                {item.licenseName && (
                  <p>{t('licenseLabel', { license: item.licenseName })}</p>
                )}
                {item.attribution && (
                  <p>
                    {t('attributionLabel', { attribution: item.attribution })}
                  </p>
                )}
                {item.sourceUrl && (
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block font-mono underline-offset-2 hover:text-foreground hover:underline"
                  >
                    {t('sourceLink')}
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
