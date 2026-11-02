'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
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

const POSE_VIEW_ORDER = [
  'front',
  'side',
  'back',
  'high',
  'low',
  'diag',
] as const;

const POSE_VIEW_LABELS: Record<string, { zh: string; en: string }> = {
  all: { zh: '全部视角', en: 'All views' },
  front: { zh: '正面', en: 'Front' },
  side: { zh: '侧面', en: 'Side' },
  back: { zh: '背面', en: 'Back' },
  high: { zh: '俯视', en: 'High' },
  low: { zh: '仰视', en: 'Low' },
  diag: { zh: '斜侧', en: '3/4' },
};

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
  const locale = useLocale();
  const isZh = locale.startsWith('zh');
  const [selectedView, setSelectedView] = useState<string>('all');
  const [onlyMale, setOnlyMale] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const availableViews = useMemo(() => {
    if (role !== 'pose') return [];
    return POSE_VIEW_ORDER.filter(view =>
      items.some(item => item.tags.includes(view))
    );
  }, [items, role]);

  const hasMalePoses = useMemo(
    () =>
      role === 'pose' &&
      items.some(
        item => item.tags.includes('male') || item.tags.includes('男性')
      ),
    [items, role]
  );

  const filteredItems = useMemo(() => {
    if (role !== 'pose') return items;
    let next = items;
    if (onlyMale) {
      next = next.filter(
        item => item.tags.includes('male') || item.tags.includes('男性')
      );
    }
    if (selectedView !== 'all') {
      next = next.filter(item => item.tags.includes(selectedView));
    }
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      next = next.filter(
        item =>
          item.title.toLowerCase().includes(query) ||
          (item.description ?? '').toLowerCase().includes(query) ||
          item.tags.some(tag => tag.toLowerCase().includes(query))
      );
    }
    return next;
  }, [items, onlyMale, role, searchQuery, selectedView]);

  if (isLoading) {
    return (
      <div
        role="status"
        data-testid={`library-loading-${role}`}
        className="rounded-md border border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground"
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
        className="space-y-3 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm"
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
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:border-foreground disabled:opacity-50"
            >
              {t('libraryRetry')}
            </button>
          )}
          {onFallbackToUpload && (
            <button
              type="button"
              disabled={disabled}
              onClick={onFallbackToUpload}
              className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background transition-opacity hover:opacity-90 disabled:opacity-50"
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
        className="space-y-3 rounded-md border border-dashed border-border bg-muted/10 p-6 text-sm"
      >
        <p className="text-muted-foreground">{t('libraryEmpty')}</p>
        {onFallbackToUpload && (
          <>
            <p className="text-muted-foreground">{t('fallbackToUploadHint')}</p>
            <button
              type="button"
              disabled={disabled}
              onClick={onFallbackToUpload}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:border-foreground disabled:opacity-50"
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
    <div className="space-y-4">
      {selectedAsset && (
        <div className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-4 py-2.5 text-sm">
          <span className="font-medium text-foreground">
            {t('selectedAsset', { title: selectedAsset.title })}
          </span>
          {optional && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSelect(null)}
              className="text-sm text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
            >
              {t('clearSelection')}
            </button>
          )}
        </div>
      )}

      <div className="space-y-3">
        {role === 'pose' && items.length > 1 && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={disabled}
                onClick={() => setSelectedView('all')}
                className={`rounded-full px-3 py-1 font-mono text-xs transition-colors ${
                  selectedView === 'all'
                    ? 'bg-foreground text-background'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {isZh ? '全部视角' : 'All views'}
              </button>
              {availableViews.map(view => {
                const label = POSE_VIEW_LABELS[view];
                return (
                  <button
                    key={view}
                    type="button"
                    disabled={disabled}
                    onClick={() => setSelectedView(view)}
                    className={`rounded-full px-3 py-1 font-mono text-xs transition-colors ${
                      selectedView === view
                        ? 'bg-foreground text-background'
                        : 'bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {label ? (isZh ? label.zh : label.en) : view}
                  </button>
                );
              })}
              {hasMalePoses && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setOnlyMale(prev => !prev)}
                  className={`rounded-full px-3 py-1 font-mono text-xs transition-colors ${
                    onlyMale
                      ? 'bg-foreground text-background'
                      : 'border border-border bg-background text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {isZh ? '仅看男性' : 'Male only'}
                </button>
              )}
            </div>

            <input
              type="search"
              value={searchQuery}
              disabled={disabled}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder={
                isZh ? '搜索姿势或标签...' : 'Search poses or tags...'
              }
              className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none sm:w-56"
            />
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {filteredItems.map(item => {
            const isSelected = selectedId === item.id;
            return (
              <div
                key={item.id}
                data-testid={`library-card-${role}-${item.id}`}
                className={`group flex flex-col overflow-hidden rounded-lg border transition-all ${
                  isSelected
                    ? 'border-foreground bg-muted/50 shadow-sm'
                    : 'border-border bg-card hover:border-foreground/60 hover:shadow-sm'
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
                  className="flex flex-col text-left transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {item.thumbnailUrl ? (
                    <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted/20">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.thumbnailUrl}
                        alt={item.title}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      />
                    </div>
                  ) : null}

                  <div className="flex-1 space-y-2 p-3">
                    <p className="font-medium leading-snug text-foreground">
                      {item.title}
                    </p>
                    {item.description ? (
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {item.description}
                      </p>
                    ) : null}

                    {item.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {item.tags.slice(0, 4).map(tag => (
                          <span
                            key={tag}
                            className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground"
                          >
                            {tag}
                          </span>
                        ))}
                        {item.tags.length > 4 && (
                          <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                            +{item.tags.length - 4}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </button>

                <div className="border-t border-border/40 bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
                  <div className="space-y-0.5">
                    {item.licenseName && (
                      <p>{t('licenseLabel', { license: item.licenseName })}</p>
                    )}
                    {item.attribution && (
                      <p>
                        {t('attributionLabel', {
                          attribution: item.attribution,
                        })}
                      </p>
                    )}
                    {item.sourceUrl && (
                      <a
                        href={item.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block font-mono underline-offset-2 transition-colors hover:text-foreground hover:underline"
                        onClick={e => e.stopPropagation()}
                      >
                        {t('sourceLink')}
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
