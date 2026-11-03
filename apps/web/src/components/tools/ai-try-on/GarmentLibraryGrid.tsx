'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { AiTryOnReferenceAssetDto } from '@/hooks/api/types';

interface GarmentLibraryGridProps {
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

type StyleCategory = {
  label: string;
  keywords: string[];
};

type GenderCategory = {
  label: string;
  keywords: string[];
};

// 画面风格分类映射
const STYLE_CATEGORIES: Record<string, StyleCategory> = {
  all: { label: '全部风格', keywords: [] },
  spring: { label: '春日穿搭', keywords: ['春日', 'spring', '春装'] },
  summer: { label: '夏日穿搭', keywords: ['夏日', 'summer', '夏装', '短裤', 'shorts'] },
  autumn: { label: '秋日穿搭', keywords: ['秋日', 'autumn', '秋装', '秋季'] },
  winter: { label: '冬日穿搭', keywords: ['冬日', 'winter', '冬装', '冬季'] },
  party: { label: '派对礼服', keywords: ['派对', 'party', '礼服', 'formal', '正装', 'dress'] },
};

// 人物性别分类映射
const GENDER_CATEGORIES: Record<string, GenderCategory> = {
  all: { label: '全部', keywords: [] },
  female: { label: '女性', keywords: ['女性', 'female', 'woman', 'girl', '女孩'] },
  male: { label: '男性', keywords: ['男性', 'male', 'man', 'boy', '男孩'] },
};

/**
 * 从标题中提取画面风格
 */
function extractStyle(title: string): string {
  const lowerTitle = title.toLowerCase();
  
  for (const [key, category] of Object.entries(STYLE_CATEGORIES)) {
    if (key === 'all') continue;
    if (category.keywords.some(keyword => 
      lowerTitle.includes(keyword.toLowerCase())
    )) {
      return key;
    }
  }
  
  return 'all';
}

/**
 * 从标签和描述中检测人物性别
 */
function detectGender(tags: string[], description?: string | null): string {
  const combined = [...tags, description || ''].join(' ').toLowerCase();
  
  // 检查女性标记
  if (GENDER_CATEGORIES.female.keywords.some(keyword =>
    combined.includes(keyword.toLowerCase())
  )) {
    return 'female';
  }
  
  // 检查男性标记
  if (GENDER_CATEGORIES.male.keywords.some(keyword =>
    combined.includes(keyword.toLowerCase())
  )) {
    return 'male';
  }
  
  return 'all';
}

export function GarmentLibraryGrid({
  items,
  selectedId,
  onSelect,
  isLoading = false,
  isError = false,
  onRetry,
  onFallbackToUpload,
  disabled = false,
  optional = false,
}: GarmentLibraryGridProps) {
  const t = useTranslations('ImageTryOn');
  const [activeStyle, setActiveStyle] = useState<string>('all');
  const [activeGender, setActiveGender] = useState<string>('all');

  // 为每个素材添加计算的风格和性别
  const itemsWithMetadata = useMemo(() => {
    return items.map(item => ({
      ...item,
      style: extractStyle(item.title),
      gender: detectGender(item.tags, item.description),
    }));
  }, [items]);

  // 按风格和性别筛选素材
  const filteredItems = useMemo(() => {
    return itemsWithMetadata.filter(item => {
      const matchStyle = activeStyle === 'all' || item.style === activeStyle;
      const matchGender = activeGender === 'all' || item.gender === activeGender;
      return matchStyle && matchGender;
    });
  }, [itemsWithMetadata, activeStyle, activeGender]);

  // 统计每个风格的数量
  const styleCounts = useMemo(() => {
    const counts: Record<string, number> = { all: itemsWithMetadata.length };
    
    Object.keys(STYLE_CATEGORIES).forEach(key => {
      if (key === 'all') return;
      
      // 只计算当前活跃性别下的数量
      counts[key] = itemsWithMetadata.filter(item => {
        const matchStyle = item.style === key;
        const matchGender = activeGender === 'all' || item.gender === activeGender;
        return matchStyle && matchGender;
      }).length;
    });
    
    return counts;
  }, [itemsWithMetadata, activeGender]);

  // 统计每个性别的数量
  const genderCounts = useMemo(() => {
    const counts: Record<string, number> = { all: itemsWithMetadata.length };
    
    Object.keys(GENDER_CATEGORIES).forEach(key => {
      if (key === 'all') return;
      
      // 只计算当前活跃风格下的数量
      counts[key] = itemsWithMetadata.filter(item => {
        const matchGender = item.gender === key;
        const matchStyle = activeStyle === 'all' || item.style === activeStyle;
        return matchGender && matchStyle;
      }).length;
    });
    
    return counts;
  }, [itemsWithMetadata, activeStyle]);

  const selectedAsset = itemsWithMetadata.find(item => item.id === selectedId);

  if (isLoading) {
    return (
      <div
        role="status"
        data-testid="garment-library-loading"
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
        data-testid="garment-library-error"
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
        data-testid="garment-library-empty"
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

  return (
    <div className="space-y-4">
      {/* 画面风格筛选 */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">画面风格</h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(STYLE_CATEGORIES).map(([key, category]) => {
            const count = styleCounts[key];
            const isActive = activeStyle === key;
            
            return (
              <button
                key={key}
                type="button"
                disabled={disabled || count === 0}
                onClick={() => setActiveStyle(key)}
                data-testid={`style-filter-${key}`}
                className={`rounded-md px-3 py-1.5 text-sm transition-all disabled:opacity-50 ${
                  isActive
                    ? 'bg-foreground text-background'
                    : 'border border-border bg-background text-foreground hover:border-foreground/60'
                }`}
              >
                {category.label}
                <span className="ml-1.5 opacity-70">({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 人物性别筛选 */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">人物性别</h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(GENDER_CATEGORIES).map(([key, category]) => {
            const count = genderCounts[key];
            const isActive = activeGender === key;
            
            return (
              <button
                key={key}
                type="button"
                disabled={disabled || count === 0}
                onClick={() => setActiveGender(key)}
                data-testid={`gender-filter-${key}`}
                className={`rounded-md px-3 py-1.5 text-sm transition-all disabled:opacity-50 ${
                  isActive
                    ? 'bg-foreground text-background'
                    : 'border border-border bg-background text-foreground hover:border-foreground/60'
                }`}
              >
                {category.label}
                <span className="ml-1.5 opacity-70">({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 已选择的素材提示 */}
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

      {/* 筛选结果为空 */}
      {filteredItems.length === 0 && (
        <div className="rounded-md border border-dashed border-border bg-muted/10 px-4 py-8 text-center text-sm text-muted-foreground">
          该筛选条件下暂无服装
        </div>
      )}

      {/* 图库网格 */}
      {filteredItems.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {filteredItems.map(item => {
            const isSelected = selectedId === item.id;
            return (
              <div
                key={item.id}
                data-testid={`garment-card-${item.id}`}
                className={`group flex flex-col overflow-hidden rounded-lg border transition-all ${
                  isSelected
                    ? 'border-foreground bg-muted/50 shadow-sm'
                    : 'border-border bg-card hover:border-foreground/60 hover:shadow-sm'
                }`}
              >
                <button
                  type="button"
                  aria-pressed={isSelected}
                  data-testid={`garment-item-${item.id}`}
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
                      <p className="text-sm leading-relaxed text-muted-foreground line-clamp-2">
                        {item.description}
                      </p>
                    ) : null}
                    
                    {item.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {item.tags.slice(0, 3).map(tag => (
                          <span
                            key={tag}
                            className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground"
                          >
                            {tag}
                          </span>
                        ))}
                        {item.tags.length > 3 && (
                          <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                            +{item.tags.length - 3}
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
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
