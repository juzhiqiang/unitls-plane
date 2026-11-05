'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  Grid,
  Search,
  X,
} from 'lucide-react';
import { ImageViewerModal } from '@/components/tools/image-viewer-modal';
import type {
  AiTryOnReferenceAssetDto,
  AiTryOnReferenceRole,
} from '@/hooks/api/types';

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

type PoseDirection = 'front' | 'high' | 'low' | 'side' | 'diag' | 'back';
type GenderFilterKey = 'all' | 'female' | 'male';
type GarmentStyleKey =
  | 'all'
  | 'spring'
  | 'summer'
  | 'autumn'
  | 'winter'
  | 'party';

const DEFAULT_PAGE_SIZE = 8;

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

const GENDER_FILTER_LABELS: Record<
  GenderFilterKey,
  { zh: string; en: string }
> = {
  all: { zh: '全部', en: 'All' },
  female: { zh: '女性', en: 'Female' },
  male: { zh: '男性', en: 'Male' },
};

const GARMENT_STYLE_CATEGORIES: Record<
  GarmentStyleKey,
  { zh: string; en: string; keywords: string[] }
> = {
  all: { zh: '全部风格', en: 'All styles', keywords: [] },
  spring: {
    zh: '春日穿搭',
    en: 'Spring',
    keywords: ['春日', 'spring', '春装'],
  },
  summer: {
    zh: '夏日穿搭',
    en: 'Summer',
    keywords: ['夏日', 'summer', '夏装', '短裤', 'shorts'],
  },
  autumn: {
    zh: '秋日穿搭',
    en: 'Autumn',
    keywords: ['秋日', 'autumn', '秋装', '秋季'],
  },
  winter: {
    zh: '冬日穿搭',
    en: 'Winter',
    keywords: ['冬日', 'winter', '冬装', '冬季'],
  },
  party: {
    zh: '派对礼服',
    en: 'Party & Formal',
    keywords: ['派对', 'party', '礼服', 'formal', '正装', 'dress'],
  },
};

const MODAL_ROLE_TITLES: Record<
  AiTryOnReferenceRole,
  { zh: string; en: string }
> = {
  person: { zh: '选择模特人像参考', en: 'Select model portrait reference' },
  garment: { zh: '选择目标服装参考', en: 'Select target garment reference' },
  pose: { zh: '选择姿势参考', en: 'Select pose reference' },
  style: {
    zh: '选择辅助穿搭风格参考',
    en: 'Select auxiliary style reference',
  },
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

function detectAssetGender(
  item: AiTryOnReferenceAssetDto
): 'female' | 'male' | 'unisex' {
  const combined = [item.title, item.description ?? '', ...item.tags]
    .join(' ')
    .toLowerCase();
  if (
    item.tags.includes('male') ||
    item.tags.includes('男性') ||
    item.tags.includes('男装') ||
    /\b(male|man|men|boy|mens|menswear)\b/.test(combined) ||
    combined.includes('男性') ||
    combined.includes('男士') ||
    combined.includes('男装')
  ) {
    return 'male';
  }
  if (
    item.tags.includes('female') ||
    item.tags.includes('女性') ||
    item.tags.includes('女装') ||
    /\b(female|woman|women|girl|womens|womenswear)\b/.test(combined) ||
    combined.includes('女性') ||
    combined.includes('女士') ||
    combined.includes('女装') ||
    combined.includes('女孩')
  ) {
    return 'female';
  }
  return item.kind === 'pose' || item.kind === 'garment' ? 'female' : 'unisex';
}

function detectGarmentStyle(item: AiTryOnReferenceAssetDto): GarmentStyleKey {
  const combined = [item.title, item.description ?? '', ...item.tags]
    .join(' ')
    .toLowerCase();
  for (const key of [
    'spring',
    'summer',
    'autumn',
    'winter',
    'party',
  ] as const) {
    const cat = GARMENT_STYLE_CATEGORIES[key];
    if (cat.keywords.some(kw => combined.includes(kw.toLowerCase()))) {
      return key;
    }
  }
  return 'all';
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
  pageSize = DEFAULT_PAGE_SIZE,
  showQuickPicks = false,
}: ReferenceLibraryGridProps) {
  const t = useTranslations('ImageTryOn');
  const locale = useLocale();
  const isZh = locale.startsWith('zh');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);
  const [genderFilter, setGenderFilter] = useState<GenderFilterKey>('all');
  const [styleFilter, setStyleFilter] = useState<GarmentStyleKey>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [activeViewByGroup, setActiveViewByGroup] = useState<
    Record<string, PoseDirection>
  >({});

  const isGarmentRole = role === 'garment' || role === 'style';

  // 将姿势按基础动作聚合为「单卡片 + 底部五方向切换」
  const poseGroups = useMemo<PoseCardGroup[]>(() => {
    if (role !== 'pose') return [];
    const map = new Map<string, PoseCardGroup>();

    for (const item of items) {
      const key = extractPoseGroupKey(item);
      const view = detectPoseDirection(item);
      let group = map.get(key);
      if (!group) {
        const g = detectAssetGender(item);
        group = {
          key,
          baseTitle: stripDirectionSuffixFromTitle(item.title),
          gender: g === 'male' ? 'male' : 'female',
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
    if (role === 'pose') {
      let female = 0;
      let male = 0;
      for (const g of poseGroups) {
        if (g.gender === 'male') male++;
        else female++;
      }
      return { all: poseGroups.length, female, male };
    }
    let female = 0;
    let male = 0;
    for (const item of items) {
      const g = detectAssetGender(item);
      if (g === 'male') male++;
      else if (g === 'female') female++;
    }
    return { all: items.length, female, male };
  }, [items, poseGroups, role]);

  const garmentStyleCounts = useMemo(() => {
    const counts: Record<GarmentStyleKey, number> = {
      all: 0,
      spring: 0,
      summer: 0,
      autumn: 0,
      winter: 0,
      party: 0,
    };
    if (!isGarmentRole) return counts;
    const baseItems =
      genderFilter === 'all'
        ? items
        : items.filter(item => detectAssetGender(item) === genderFilter);
    counts.all = baseItems.length;
    for (const item of baseItems) {
      const s = detectGarmentStyle(item);
      if (s !== 'all') counts[s]++;
    }
    return counts;
  }, [genderFilter, isGarmentRole, items]);

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

  const filteredStandardItems = useMemo(() => {
    if (role === 'pose') return [];
    let next = items;
    if (genderFilter !== 'all') {
      next = next.filter(item => detectAssetGender(item) === genderFilter);
    }
    if (isGarmentRole && styleFilter !== 'all') {
      next = next.filter(item => detectGarmentStyle(item) === styleFilter);
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
  }, [genderFilter, isGarmentRole, items, role, searchQuery, styleFilter]);

  const totalUnits =
    role === 'pose' ? filteredPoseGroups.length : filteredStandardItems.length;
  const totalPages = Math.max(1, Math.ceil(totalUnits / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const startIdx = (safePage - 1) * pageSize;

  // 按 ESC 关闭弹窗，左右方向键翻页
  useEffect(() => {
    if (!isModalOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsModalOpen(false);
      } else if (event.key === 'ArrowLeft') {
        setCurrentPage(p => Math.max(1, p - 1));
      } else if (event.key === 'ArrowRight') {
        setCurrentPage(p => Math.min(totalPages, p + 1));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen, totalPages]);

  const paginatedPoseGroups = useMemo(
    () => filteredPoseGroups.slice(startIdx, startIdx + pageSize),
    [filteredPoseGroups, pageSize, startIdx]
  );

  const paginatedStandardItems = useMemo(
    () => filteredStandardItems.slice(startIdx, startIdx + pageSize),
    [filteredStandardItems, pageSize, startIdx]
  );

  const quickPickItems = useMemo<AiTryOnReferenceAssetDto[]>(() => {
    if (items.length === 0) return [];
    if (role === 'pose') {
      return poseGroups.slice(0, 4).map(g => g.variants[0]!.item);
    }
    return items.slice(0, 4);
  }, [items, poseGroups, role]);

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
      ? poseGroups.find(g => g.variants.some(v => v.item.id === selectedId))
      : undefined;

  const modalTitle = MODAL_ROLE_TITLES[role];
  const libraryCountText =
    role === 'pose'
      ? isZh
        ? `共 ${poseGroups.length} 组多视角姿势可选`
        : `${poseGroups.length} multi-angle poses available`
      : isZh
        ? `共 ${items.length} 项图库素材可选`
        : `${items.length} library assets available`;

  return (
    <div className="space-y-3">
      {/* 主页面紧凑摘要卡：已选状态 vs 未选触发器 */}
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
                  title={isZh ? '点击查看大图' : 'Click to view'}
                  onClick={() => setZoomSrc(selectedAsset.thumbnailUrl)}
                  onKeyDown={e =>
                    e.key === 'Enter' && setZoomSrc(selectedAsset.thumbnailUrl)
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
                    onClick={() => setIsModalOpen(true)}
                    className="inline-flex items-center gap-1 rounded border border-border bg-background px-2.5 py-1 font-mono text-xs text-foreground transition-colors hover:border-foreground disabled:opacity-50"
                  >
                    <Grid className="h-3 w-3" />
                    {isZh ? '更换素材' : 'Change'}
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
                const isActive = variantItem.id === selectedId;
                const viewLabel = POSE_DIRECTION_LABELS[view];
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
                      {isZh ? viewLabel.zh : viewLabel.en}
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
                {isZh ? modalTitle.zh : modalTitle.en}
              </p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {libraryCountText}
              </p>
            </div>
            <button
              type="button"
              data-testid={`open-library-modal-${role}`}
              disabled={disabled}
              onClick={() => setIsModalOpen(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Grid className="h-3.5 w-3.5" />
              {isZh ? '从图库选择' : 'Browse library'}
            </button>
          </div>

          {/* 快捷推荐项（直接在卡片内一键点选，无需打开弹窗） */}
          {!isModalOpen && showQuickPicks && quickPickItems.length > 0 && (
            <div className="space-y-1.5 pt-1 border-t border-border/50">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {isZh
                  ? '常用精选（点击直接选定）：'
                  : 'Quick picks (click to select):'}
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

      {/* 图库弹窗（Modal + 分页） */}
      {isModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={isZh ? modalTitle.zh : modalTitle.en}
          data-testid={`library-modal-${role}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* 弹窗头部 */}
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  {isZh ? modalTitle.zh : modalTitle.en}
                </h3>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {libraryCountText}
                </p>
              </div>
              <button
                type="button"
                aria-label={isZh ? '关闭图库弹窗' : 'Close library modal'}
                data-testid={`close-library-modal-${role}`}
                onClick={() => setIsModalOpen(false)}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* 弹窗筛选与搜索工具栏 */}
            <div className="space-y-2.5 border-b border-border bg-muted/15 px-5 py-3">
              <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                {/* 性别筛选（姿势 / 服装 / 人像通用） */}
                <div
                  role="group"
                  aria-label={isZh ? '按性别筛选' : 'Filter by gender'}
                  className="flex flex-wrap items-center gap-1.5"
                >
                  {(['all', 'female', 'male'] as const).map(genderKey => {
                    const labelObj = GENDER_FILTER_LABELS[genderKey];
                    const count = genderCounts[genderKey];
                    if (
                      role !== 'pose' &&
                      !isGarmentRole &&
                      genderKey !== 'all' &&
                      count === 0
                    ) {
                      return null;
                    }
                    const isActive = genderFilter === genderKey;
                    return (
                      <button
                        key={genderKey}
                        type="button"
                        data-testid={
                          role === 'pose'
                            ? `pose-gender-filter-${genderKey}`
                            : `gender-filter-${genderKey}`
                        }
                        aria-pressed={isActive}
                        disabled={disabled}
                        onClick={() => {
                          setGenderFilter(genderKey);
                          setStyleFilter('all');
                          setCurrentPage(1);
                        }}
                        className={`rounded-full px-3 py-1 font-mono text-xs font-medium transition-colors ${
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

                {/* 搜索框 */}
                <div className="relative w-full sm:w-64">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="search"
                    value={searchQuery}
                    disabled={disabled}
                    onChange={event => {
                      setSearchQuery(event.target.value);
                      setCurrentPage(1);
                    }}
                    placeholder={
                      isZh ? '搜索名称或标签...' : 'Search name or tags...'
                    }
                    className="h-8 w-full rounded-md border border-border bg-background pr-2.5 pl-8 text-xs text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
                  />
                </div>
              </div>

              {/* 服装风格筛选（仅服装 / 辅助风格展示） */}
              {isGarmentRole && items.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      'all',
                      'spring',
                      'summer',
                      'autumn',
                      'winter',
                      'party',
                    ] as const
                  ).map(styleKey => {
                    const cat = GARMENT_STYLE_CATEGORIES[styleKey];
                    const count = garmentStyleCounts[styleKey];
                    if (styleKey !== 'all' && count === 0) return null;
                    const isActive = styleFilter === styleKey;
                    return (
                      <button
                        key={styleKey}
                        type="button"
                        data-testid={`style-filter-${styleKey}`}
                        aria-pressed={isActive}
                        disabled={disabled}
                        onClick={() => {
                          setStyleFilter(styleKey);
                          setCurrentPage(1);
                        }}
                        className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                          isActive
                            ? 'bg-foreground text-background'
                            : 'border border-border bg-background text-muted-foreground hover:border-foreground/60 hover:text-foreground'
                        } disabled:opacity-50`}
                      >
                        {isZh ? cat.zh : cat.en} ({count})
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 弹窗内容网格（分页渲染） */}
            <div className="flex-1 overflow-y-auto p-5">
              {totalUnits === 0 ? (
                <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
                  {isZh
                    ? '没有找到匹配的参考图，请尝试其他关键词或筛选条件。'
                    : 'No matching references found.'}
                </div>
              ) : role === 'pose' ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {paginatedPoseGroups.map(group => {
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

                        <button
                          type="button"
                          aria-pressed={selectedId === activeItem.id}
                          data-testid={`library-item-pose-${activeItem.id}`}
                          disabled={disabled}
                          onClick={() => {
                            const nextId =
                              optional && selectedId === activeItem.id
                                ? null
                                : activeItem.id;
                            onSelect(nextId);
                            if (nextId) {
                              setIsModalOpen(false);
                            }
                          }}
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
                            aria-label={
                              isZh ? '切换姿势方向' : 'Switch pose angle'
                            }
                            className="mt-2.5 grid grid-cols-5 gap-1.5 rounded-xl border border-border/80 bg-muted/20 p-1.5"
                          >
                            {group.variants.map(
                              ({ view, item: variantItem }) => {
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
                              }
                            )}
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
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {paginatedStandardItems.map(item => {
                    const isSelected = selectedId === item.id;
                    const itemGender = detectAssetGender(item);
                    const displayTags = item.tags.filter(
                      tag =>
                        ![
                          'female',
                          'male',
                          '女性',
                          '男性',
                          'photo',
                          'anime',
                        ].includes(tag)
                    );
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
                          onClick={() => {
                            const nextId =
                              optional && isSelected ? null : item.id;
                            onSelect(nextId);
                            if (nextId) {
                              setIsModalOpen(false);
                            }
                          }}
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
                              {isGarmentRole && itemGender !== 'unisex' && (
                                <span className="absolute top-2 left-2 rounded bg-background/90 px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground shadow-xs backdrop-blur-xs">
                                  {itemGender === 'male'
                                    ? isZh
                                      ? '男装'
                                      : 'Male'
                                    : isZh
                                      ? '女装'
                                      : 'Female'}
                                </span>
                              )}
                              {role === 'person' && itemGender !== 'unisex' && (
                                <span className="absolute top-2 left-2 rounded bg-background/90 px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground shadow-xs backdrop-blur-xs">
                                  {itemGender === 'male'
                                    ? isZh
                                      ? '男性'
                                      : 'Male'
                                    : isZh
                                      ? '女性'
                                      : 'Female'}
                                </span>
                              )}
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

                            {displayTags.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {displayTags.slice(0, 4).map(tag => (
                                  <span
                                    key={tag}
                                    className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground"
                                  >
                                    {tag}
                                  </span>
                                ))}
                                {displayTags.length > 4 && (
                                  <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                                    +{displayTags.length - 4}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </button>

                        <div className="border-t border-border/40 bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
                          <div className="space-y-0.5">
                            {item.licenseName && (
                              <p>
                                {t('licenseLabel', {
                                  license: item.licenseName,
                                })}
                              </p>
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
              )}
            </div>

            {/* 弹窗底部分页与确认栏 */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/15 px-5 py-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid={`library-prev-page-${role}`}
                  disabled={safePage <= 1}
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2.5 font-mono text-xs text-foreground transition-colors hover:border-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  {isZh ? '上一页' : 'Prev'}
                </button>
                <span
                  data-testid={`library-page-indicator-${role}`}
                  className="px-2 font-mono text-xs text-muted-foreground"
                >
                  {isZh
                    ? `第 ${safePage} / ${totalPages} 页（共 ${totalUnits} 项）`
                    : `Page ${safePage} / ${totalPages} (${totalUnits})`}
                </span>
                <button
                  type="button"
                  data-testid={`library-next-page-${role}`}
                  disabled={safePage >= totalPages}
                  onClick={() =>
                    setCurrentPage(p => Math.min(totalPages, p + 1))
                  }
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2.5 font-mono text-xs text-foreground transition-colors hover:border-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isZh ? '下一页' : 'Next'}
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                {selectedAsset && optional && (
                  <button
                    type="button"
                    onClick={() => onSelect(null)}
                    className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
                  >
                    {t('clearSelection')}
                  </button>
                )}
                <button
                  type="button"
                  data-testid={`confirm-library-modal-${role}`}
                  onClick={() => setIsModalOpen(false)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-4 font-mono text-xs text-background transition-opacity hover:opacity-90"
                >
                  <Check className="h-3.5 w-3.5" />
                  {isZh ? '确认完成' : 'Done'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* 素材大图放大预览 */}
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
