'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ImageViewerModal } from '@/components/tools/image-viewer-modal';
import type {
  AiTryOnReferenceAssetDto,
  AiTryOnReferenceRole,
} from '@/hooks/api/types';
import { ReferenceLibraryCard } from './ReferenceLibraryCard';
import { ReferenceLibraryFilters } from './ReferenceLibraryFilters';
import { ReferenceLibraryModal } from './ReferenceLibraryModal';
import { ReferenceLibraryPoseCard } from './ReferenceLibraryPoseCard';
import { ReferenceLibrarySummary } from './ReferenceLibrarySummary';
import {
  countGarmentStyles,
  countLibraryGenders,
  filterPoseGroups,
  filterReferenceAssets,
  groupPoseAssets,
  type GarmentStyleKey,
  type GenderFilterKey,
  type PoseDirection,
} from './referenceLibrary';

export interface ReferenceLibraryGridProps {
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
  pageSize?: number;
  showQuickPicks?: boolean;
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
  pageSize = 8,
  showQuickPicks = false,
}: ReferenceLibraryGridProps) {
  const t = useTranslations('ImageTryOn');
  const r = useTranslations('ImageTryOn.referenceLibrary');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);
  const [genderFilter, setGenderFilter] = useState<GenderFilterKey>('all');
  const [styleFilter, setStyleFilter] = useState<GarmentStyleKey>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [activeViewByGroup, setActiveViewByGroup] = useState<
    Record<string, PoseDirection>
  >({});

  const poseGroups = useMemo(
    () => (role === 'pose' ? groupPoseAssets(items) : []),
    [items, role]
  );
  const genderCounts = useMemo(
    () => countLibraryGenders(items, poseGroups, role),
    [items, poseGroups, role]
  );
  const garmentStyleCounts = useMemo(
    () => countGarmentStyles(items, genderFilter),
    [items, genderFilter]
  );
  const filteredPoseGroups = useMemo(
    () => filterPoseGroups(poseGroups, genderFilter, searchQuery),
    [poseGroups, genderFilter, searchQuery]
  );
  const filteredStandardItems = useMemo(
    () =>
      role === 'pose'
        ? []
        : filterReferenceAssets(
            items,
            role,
            genderFilter,
            styleFilter,
            searchQuery
          ),
    [items, role, genderFilter, styleFilter, searchQuery]
  );
  const totalUnits =
    role === 'pose' ? filteredPoseGroups.length : filteredStandardItems.length;
  const totalPages = Math.max(1, Math.ceil(totalUnits / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const quickPickItems = useMemo(
    () =>
      role === 'pose'
        ? poseGroups.slice(0, 4).map(group => group.variants[0]!.item)
        : items.slice(0, 4),
    [items, poseGroups, role]
  );

  const selectModalAsset = (assetId: string) => {
    const nextId = optional && selectedId === assetId ? null : assetId;
    onSelect(nextId);
    if (nextId) setIsModalOpen(false);
  };

  if (isLoading) {
    return (
      <div
        role="status"
        data-testid={`library-loading-${role}`}
        className="rounded-md border border-border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground"
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
        className="space-y-3 rounded-md border border-dashed border-border bg-muted/10 p-5 text-sm"
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
  const selectedPoseGroup =
    role === 'pose' && selectedId
      ? poseGroups.find(group =>
          group.variants.some(({ item }) => item.id === selectedId)
        )
      : undefined;
  const libraryCountText =
    role === 'pose'
      ? r('poseCount', { count: poseGroups.length })
      : r('assetCount', { count: items.length });

  return (
    <div className="space-y-3">
      <ReferenceLibrarySummary
        role={role}
        selectedAsset={selectedAsset}
        selectedPoseGroup={selectedPoseGroup}
        quickPickItems={quickPickItems}
        showQuickPicks={showQuickPicks}
        isModalOpen={isModalOpen}
        disabled={disabled}
        optional={optional}
        libraryCountText={libraryCountText}
        onOpen={() => setIsModalOpen(true)}
        onZoom={setZoomSrc}
        onSelect={onSelect}
      />
      {isModalOpen && (
        <ReferenceLibraryModal
          role={role}
          libraryCountText={libraryCountText}
          currentPage={safePage}
          totalPages={totalPages}
          totalUnits={totalUnits}
          hasSelection={Boolean(selectedAsset)}
          optional={optional}
          onClose={() => setIsModalOpen(false)}
          onPageChange={setCurrentPage}
          onClear={() => onSelect(null)}
        >
          <ReferenceLibraryFilters
            role={role}
            itemCount={items.length}
            disabled={disabled}
            genderFilter={genderFilter}
            styleFilter={styleFilter}
            searchQuery={searchQuery}
            genderCounts={genderCounts}
            garmentStyleCounts={garmentStyleCounts}
            onGenderChange={gender => {
              setGenderFilter(gender);
              setStyleFilter('all');
              setCurrentPage(1);
            }}
            onStyleChange={style => {
              setStyleFilter(style);
              setCurrentPage(1);
            }}
            onSearchChange={query => {
              setSearchQuery(query);
              setCurrentPage(1);
            }}
          />
          <div className="flex-1 overflow-y-auto p-5">
            {totalUnits === 0 ? (
              <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
                {r('noMatches')}
              </div>
            ) : role === 'pose' ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {filteredPoseGroups
                  .slice(startIndex, startIndex + pageSize)
                  .map(group => (
                    <ReferenceLibraryPoseCard
                      key={group.key}
                      group={group}
                      selectedId={selectedId}
                      rememberedView={activeViewByGroup[group.key]}
                      disabled={disabled}
                      onSelect={selectModalAsset}
                      onViewChange={(key, view, assetId) => {
                        setActiveViewByGroup(previous => ({
                          ...previous,
                          [key]: view,
                        }));
                        onSelect(assetId);
                      }}
                    />
                  ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {filteredStandardItems
                  .slice(startIndex, startIndex + pageSize)
                  .map(item => (
                    <ReferenceLibraryCard
                      key={item.id}
                      item={item}
                      role={role}
                      selectedId={selectedId}
                      disabled={disabled}
                      onSelect={selectModalAsset}
                    />
                  ))}
              </div>
            )}
          </div>
        </ReferenceLibraryModal>
      )}
      {zoomSrc && (
        <ImageViewerModal
          src={zoomSrc}
          alt={selectedAsset?.title ?? ''}
          isOpen={Boolean(zoomSrc)}
          onClose={() => setZoomSrc(null)}
        />
      )}
    </div>
  );
}
