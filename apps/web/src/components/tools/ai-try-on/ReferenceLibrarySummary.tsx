'use client';

import { useTranslations } from 'next-intl';
import { Eye, Grid } from 'lucide-react';
import type {
  AiTryOnReferenceAssetDto,
  AiTryOnReferenceRole,
} from '@/hooks/api/types';
import type { PoseCardGroup } from './referenceLibrary';

interface ReferenceLibrarySummaryProps {
  role: AiTryOnReferenceRole;
  selectedAsset?: AiTryOnReferenceAssetDto;
  selectedPoseGroup?: PoseCardGroup;
  quickPickItems: AiTryOnReferenceAssetDto[];
  showQuickPicks: boolean;
  isModalOpen: boolean;
  disabled: boolean;
  optional: boolean;
  libraryCountText: string;
  onOpen: () => void;
  onZoom: (src: string) => void;
  onSelect: (assetId: string | null) => void;
}

export function ReferenceLibrarySummary({
  role,
  selectedAsset,
  selectedPoseGroup,
  quickPickItems,
  showQuickPicks,
  isModalOpen,
  disabled,
  optional,
  libraryCountText,
  onOpen,
  onZoom,
  onSelect,
}: ReferenceLibrarySummaryProps) {
  const t = useTranslations('ImageTryOn');
  const r = useTranslations('ImageTryOn.referenceLibrary');
  return (
    <>
      {selectedAsset ? (
        <div
          data-testid={`selected-summary-${role}`}
          className="rounded-lg border border-border bg-muted/20 p-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              {selectedAsset.thumbnailUrl ? (
                <div
                  role="button"
                  tabIndex={0}
                  title={r('viewImage')}
                  onClick={() => onZoom(selectedAsset.thumbnailUrl)}
                  onKeyDown={e =>
                    e.key === 'Enter' && onZoom(selectedAsset.thumbnailUrl)
                  }
                  className="group/thumb relative h-16 w-16 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border bg-white"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={selectedAsset.thumbnailUrl}
                    alt={selectedAsset.title}
                    className="h-full w-full object-contain transition-transform group-hover/thumb:scale-105"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover/thumb:opacity-100 transition-opacity">
                    <Eye className="h-4 w-4 text-white" />
                  </div>
                </div>
              ) : null}
              <div className="min-w-0 space-y-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {t('selectedAsset', { title: selectedAsset.title })}
                </p>
                {selectedAsset.description ? (
                  <p className="truncate text-xs text-muted-foreground">
                    {selectedAsset.description}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    data-testid={`open-library-modal-${role}`}
                    disabled={disabled}
                    onClick={() => onOpen()}
                    className="inline-flex items-center gap-1 rounded border border-border bg-background px-2.5 py-1 font-mono text-xs text-foreground transition-colors hover:border-foreground disabled:opacity-50"
                  >
                    <Grid className="h-3 w-3" />
                    {r('changeAsset')}
                  </button>
                  {optional && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onSelect(null)}
                      className="text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
                    >
                      {t('clearSelection')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 若当前选中的是多视角姿势，在摘要卡内直接提供五方向快捷切换 */}
          {selectedPoseGroup && selectedPoseGroup.variants.length > 1 && (
            <div className="mt-3 grid grid-cols-5 gap-1.5 rounded-xl border border-border/80 bg-background/60 p-1.5">
              {selectedPoseGroup.variants.map(({ view, item: variantItem }) => {
                const isActive = variantItem.id === selectedAsset.id;
                return (
                  <button
                    key={variantItem.id}
                    type="button"
                    aria-pressed={isActive}
                    disabled={disabled}
                    onClick={() => onSelect(variantItem.id)}
                    className={`flex flex-col items-center rounded-lg border p-1 transition-all ${
                      isActive
                        ? 'border-blue-600 bg-blue-50/40 text-blue-600 shadow-sm dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-300'
                        : 'border-transparent bg-background text-muted-foreground hover:border-border hover:text-foreground'
                    } disabled:opacity-50`}
                  >
                    {variantItem.thumbnailUrl ? (
                      <div className="h-10 w-full overflow-hidden rounded bg-white">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={variantItem.thumbnailUrl}
                          alt={variantItem.title}
                          loading="lazy"
                          className="h-full w-full object-contain"
                        />
                      </div>
                    ) : null}
                    <span className="mt-0.5 truncate text-[11px] font-medium">
                      {r(`directions.${view}`)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3 rounded-lg border-2 border-dashed border-border/60 bg-muted/10 p-4">
          <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-foreground">
                {r(`titles.${role}`)}
              </p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {libraryCountText}
              </p>
            </div>
            <button
              type="button"
              data-testid={`open-library-modal-${role}`}
              disabled={disabled}
              onClick={() => onOpen()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Grid className="h-3.5 w-3.5" />
              {r('browse')}
            </button>
          </div>

          {/* 快捷推荐项（直接在卡片内一键点选，无需打开弹窗） */}
          {!isModalOpen && showQuickPicks && quickPickItems.length > 0 && (
            <div className="space-y-1.5 pt-1 border-t border-border/50">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {r('quickPicks')}
              </span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {quickPickItems.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => onSelect(item.id)}
                    className="group flex items-center gap-2 rounded-md border border-border bg-background/80 p-1.5 text-left transition-all hover:border-foreground/60 hover:bg-background hover:shadow-xs disabled:opacity-50"
                  >
                    {item.thumbnailUrl && (
                      <div className="h-9 w-9 shrink-0 overflow-hidden rounded bg-white">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.thumbnailUrl}
                          alt={item.title}
                          className="h-full w-full object-contain"
                        />
                      </div>
                    )}
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                      {item.title}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
