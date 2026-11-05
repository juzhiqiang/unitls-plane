'use client';

import { useTranslations } from 'next-intl';
import {
  getActivePoseVariant,
  type PoseCardGroup,
  type PoseDirection,
} from './referenceLibrary';

interface ReferenceLibraryPoseCardProps {
  group: PoseCardGroup;
  selectedId: string | null;
  rememberedView?: PoseDirection;
  disabled: boolean;
  onSelect: (assetId: string) => void;
  onViewChange: (
    groupKey: string,
    view: PoseDirection,
    assetId: string
  ) => void;
}

export function ReferenceLibraryPoseCard({
  group,
  selectedId,
  rememberedView,
  disabled,
  onSelect,
  onViewChange,
}: ReferenceLibraryPoseCardProps) {
  const t = useTranslations('ImageTryOn');
  const r = useTranslations('ImageTryOn.referenceLibrary');
  const activeEntry = getActivePoseVariant(group, selectedId, rememberedView);
  const activeItem = activeEntry.item;
  const isCardSelected = group.variants.some(
    ({ item }) => item.id === selectedId
  );
  return (
    <div
      data-testid={`library-card-pose-${activeItem.id}`}
      className={`group flex flex-col overflow-hidden rounded-2xl border p-3 transition-all ${
        isCardSelected
          ? 'border-blue-600 bg-blue-50/20 shadow-sm dark:border-blue-400 dark:bg-blue-950/20'
          : 'border-border bg-card hover:border-foreground/50 hover:shadow-sm'
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {r('poseBadge', { gender: r(`poseGenders.${group.gender}`) })}
        </span>
        <span className="truncate text-xs font-medium text-foreground">
          {group.baseTitle}
        </span>
      </div>

      <button
        type="button"
        aria-pressed={selectedId === activeItem.id}
        data-testid={`library-item-pose-${activeItem.id}`}
        disabled={disabled}
        onClick={() => onSelect(activeItem.id)}
        className="relative flex flex-col overflow-hidden rounded-xl bg-white text-left transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
      >
        {activeItem.thumbnailUrl ? (
          <div className="relative aspect-[4/5] w-full overflow-hidden bg-white p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={activeItem.thumbnailUrl}
              alt={activeItem.title}
              loading="lazy"
              className="h-full w-full object-contain transition-transform group-hover:scale-[1.02]"
            />
          </div>
        ) : null}
      </button>

      {/* 底部五方向切换栏：正面 / 俯视 / 仰视 / 侧面 / 斜侧 */}
      {group.variants.length > 1 && (
        <div
          role="group"
          aria-label={r('switchPoseAngle')}
          className="mt-2.5 grid grid-cols-5 gap-1.5 rounded-xl border border-border/80 bg-muted/20 p-1.5"
        >
          {group.variants.map(({ view, item: variantItem }) => {
            const isActiveView = activeEntry.view === view;
            return (
              <button
                key={variantItem.id}
                type="button"
                data-testid={`pose-direction-${group.key}-${view}`}
                aria-pressed={selectedId === variantItem.id}
                disabled={disabled}
                onClick={() => onViewChange(group.key, view, variantItem.id)}
                className={`flex flex-col items-center rounded-lg border p-1 transition-all ${
                  isActiveView
                    ? 'border-blue-600 bg-background text-blue-600 shadow-sm dark:border-blue-400 dark:text-blue-300'
                    : 'border-transparent bg-background/60 text-muted-foreground hover:border-border hover:bg-background hover:text-foreground'
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {variantItem.thumbnailUrl ? (
                  <div className="aspect-[3/4] w-full overflow-hidden rounded bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={variantItem.thumbnailUrl}
                      alt={variantItem.title}
                      loading="lazy"
                      className="h-full w-full object-contain"
                    />
                  </div>
                ) : null}
                <span className="mt-1 truncate text-[11px] font-medium leading-tight">
                  {r(`directions.${view}`)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2 px-1 text-[11px] text-muted-foreground">
        <span className="truncate">
          {activeItem.attribution || activeItem.licenseName}
        </span>
        {activeItem.sourceUrl && (
          <a
            href={activeItem.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 font-mono underline-offset-2 hover:text-foreground hover:underline"
            onClick={e => e.stopPropagation()}
          >
            {t('sourceLink')}
          </a>
        )}
      </div>
    </div>
  );
}
