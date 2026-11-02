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

type PoseDirection = 'front' | 'high' | 'low' | 'side' | 'diag' | 'back';
type PoseGenderFilter = 'all' | 'female' | 'male';

/**
 * 五方向固定顺序：正面 → 俯视 → 仰视 → 侧面 → 斜侧（兼容 back）
 */
const POSE_DIRECTION_ORDER: PoseDirection[] = [
  'front',
  'high',
  'low',
  'side',
  'diag',
  'back',
];

const POSE_DIRECTION_LABELS: Record<PoseDirection, { zh: string; en: string }> =
  {
    front: { zh: '正面', en: 'Front' },
    high: { zh: '俯视', en: 'High' },
    low: { zh: '仰视', en: 'Low' },
    side: { zh: '侧面', en: 'Side' },
    diag: { zh: '斜侧', en: '3/4' },
    back: { zh: '背面', en: 'Back' },
  };

const POSE_GENDER_LABELS: Record<PoseGenderFilter, { zh: string; en: string }> =
  {
    all: { zh: '全部', en: 'All' },
    female: { zh: '女性', en: 'Female' },
    male: { zh: '男性', en: 'Male' },
  };

interface PoseVariantEntry {
  view: PoseDirection;
  item: AiTryOnReferenceAssetDto;
}

interface PoseCardGroup {
  key: string;
  baseTitle: string;
  gender: 'female' | 'male';
  variants: PoseVariantEntry[];
}

function detectPoseDirection(item: AiTryOnReferenceAssetDto): PoseDirection {
  const thumbMatch = item.thumbnailUrl.match(
    /_(front|high|low|side|diag|back)\.[a-z0-9]+$/i
  );
  if (thumbMatch?.[1]) {
    return thumbMatch[1].toLowerCase() as PoseDirection;
  }
  for (const dir of POSE_DIRECTION_ORDER) {
    if (item.tags.includes(dir)) return dir;
  }
  return 'front';
}

function extractPoseGroupKey(item: AiTryOnReferenceAssetDto): string {
  const strippedThumb = item.thumbnailUrl.replace(
    /_(front|high|low|side|diag|back)(\.[a-z0-9]+)$/i,
    '$2'
  );
  if (strippedThumb !== item.thumbnailUrl) {
    return strippedThumb;
  }
  return item.id;
}

function stripDirectionSuffixFromTitle(title: string): string {
  return title
    .replace(/（(正面|俯视|仰视|侧面|斜侧|背面|高角度|低角度)）\s*$/, '')
    .replace(
      /\s*\((Front|High angle|Low angle|Side|Three-quarter|Back|front|high|low|side|diag|back)\)\s*$/i,
      ''
    )
    .trim();
}

function detectPoseGender(item: AiTryOnReferenceAssetDto): 'female' | 'male' {
  if (item.tags.includes('male') || item.tags.includes('男性')) {
    return 'male';
  }
  return 'female';
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
  const locale = useLocale();
  const isZh = locale.startsWith('zh');

  const [genderFilter, setGenderFilter] = useState<PoseGenderFilter>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeViewByGroup, setActiveViewByGroup] = useState<
    Record<string, PoseDirection>
  >({});

  // 将姿势按基础动作聚合为「单卡片 + 底部五方向切换」
  const poseGroups = useMemo<PoseCardGroup[]>(() => {
    if (role !== 'pose') return [];
    const map = new Map<string, PoseCardGroup>();

    for (const item of items) {
      const key = extractPoseGroupKey(item);
      const view = detectPoseDirection(item);
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          baseTitle: stripDirectionSuffixFromTitle(item.title),
          gender: detectPoseGender(item),
          variants: [],
        };
        map.set(key, group);
      }
      if (!group.variants.some(v => v.view === view)) {
        group.variants.push({ view, item });
      }
    }

    for (const group of map.values()) {
      group.variants.sort(
        (a, b) =>
          POSE_DIRECTION_ORDER.indexOf(a.view) -
          POSE_DIRECTION_ORDER.indexOf(b.view)
      );
    }

    return Array.from(map.values());
  }, [items, role]);

  const genderCounts = useMemo(() => {
    let female = 0;
    let male = 0;
    for (const g of poseGroups) {
      if (g.gender === 'male') male++;
      else female++;
    }
    return {
      all: poseGroups.length,
      female,
      male,
    };
  }, [poseGroups]);

  const filteredPoseGroups = useMemo(() => {
    if (role !== 'pose') return [];
    let next = poseGroups;
    if (genderFilter !== 'all') {
      next = next.filter(group => group.gender === genderFilter);
    }
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      next = next.filter(
        group =>
          group.baseTitle.toLowerCase().includes(query) ||
          group.variants.some(
            ({ item }) =>
              item.title.toLowerCase().includes(query) ||
              (item.description ?? '').toLowerCase().includes(query) ||
              item.tags.some(tag => tag.toLowerCase().includes(query))
          )
      );
    }
    return next;
  }, [genderFilter, poseGroups, role, searchQuery]);

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

  // 姿势参考专属视图：顶部按性别筛选 + 卡片内底部五方向缩略图切换
  if (role === 'pose') {
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

        {/* 顶部筛选栏：按性别类型区分 + 搜索框 */}
        {poseGroups.length > 1 && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div
              role="group"
              aria-label={isZh ? '按性别筛选姿势' : 'Filter poses by gender'}
              className="flex flex-wrap items-center gap-2"
            >
              {(['all', 'female', 'male'] as const).map(genderKey => {
                const labelObj = POSE_GENDER_LABELS[genderKey];
                const count = genderCounts[genderKey];
                const isActive = genderFilter === genderKey;
                return (
                  <button
                    key={genderKey}
                    type="button"
                    data-testid={`pose-gender-filter-${genderKey}`}
                    aria-pressed={isActive}
                    disabled={disabled}
                    onClick={() => setGenderFilter(genderKey)}
                    className={`rounded-full px-3.5 py-1.5 font-mono text-xs font-medium transition-colors ${
                      isActive
                        ? 'bg-foreground text-background'
                        : 'border border-border bg-background text-muted-foreground hover:border-foreground/60 hover:text-foreground'
                    } disabled:opacity-50`}
                  >
                    {isZh ? labelObj.zh : labelObj.en} ({count})
                  </button>
                );
              })}
            </div>

            <input
              type="search"
              value={searchQuery}
              disabled={disabled}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder={isZh ? '搜索姿势名称或标签...' : 'Search poses...'}
              className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none sm:w-56"
            />
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {filteredPoseGroups.map(group => {
            const selectedVariantInGroup = group.variants.find(
              v => v.item.id === selectedId
            );
            const rememberedView = activeViewByGroup[group.key];
            const activeEntry =
              selectedVariantInGroup ??
              (rememberedView
                ? group.variants.find(v => v.view === rememberedView)
                : undefined) ??
              group.variants[0]!;
            const activeItem = activeEntry.item;
            const isCardSelected = Boolean(selectedVariantInGroup);

            return (
              <div
                key={group.key}
                data-testid={`library-card-pose-${activeItem.id}`}
                className={`group flex flex-col overflow-hidden rounded-2xl border p-3 transition-all ${
                  isCardSelected
                    ? 'border-blue-600 bg-blue-50/20 shadow-sm dark:border-blue-400 dark:bg-blue-950/20'
                    : 'border-border bg-card hover:border-foreground/50 hover:shadow-sm'
                }`}
              >
                {/* 卡片顶部标识栏 */}
                <div className="mb-2 flex items-center justify-between gap-2 px-1">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    POSE ·{' '}
                    {group.gender === 'male'
                      ? isZh
                        ? '男'
                        : 'MALE'
                      : isZh
                        ? '女'
                        : 'FEMALE'}
                  </span>
                  <span className="truncate text-xs font-medium text-foreground">
                    {group.baseTitle}
                  </span>
                </div>

                {/* 主图预览区 */}
                <button
                  type="button"
                  aria-pressed={selectedId === activeItem.id}
                  data-testid={`library-item-pose-${activeItem.id}`}
                  disabled={disabled}
                  onClick={() =>
                    onSelect(
                      optional && selectedId === activeItem.id
                        ? null
                        : activeItem.id
                    )
                  }
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

                {/* 底部五方向切换栏（对应截图样式：正面 / 俯视 / 仰视 / 侧面 / 斜侧） */}
                {group.variants.length > 1 && (
                  <div
                    role="group"
                    aria-label={isZh ? '切换姿势方向' : 'Switch pose angle'}
                    className="mt-2.5 grid grid-cols-5 gap-1.5 rounded-xl border border-border/80 bg-muted/20 p-1.5"
                  >
                    {group.variants.map(({ view, item: variantItem }) => {
                      const isActiveView = activeEntry.view === view;
                      const viewLabel = POSE_DIRECTION_LABELS[view];
                      return (
                        <button
                          key={variantItem.id}
                          type="button"
                          data-testid={`pose-direction-${group.key}-${view}`}
                          aria-pressed={selectedId === variantItem.id}
                          disabled={disabled}
                          onClick={() => {
                            setActiveViewByGroup(prev => ({
                              ...prev,
                              [group.key]: view,
                            }));
                            onSelect(variantItem.id);
                          }}
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
                            {isZh ? viewLabel.zh : viewLabel.en}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* 署名与许可信息 */}
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
          })}
        </div>
      </div>
    );
  }

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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {items.map(item => {
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
                      {t('attributionLabel', { attribution: item.attribution })}
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
  );
}
