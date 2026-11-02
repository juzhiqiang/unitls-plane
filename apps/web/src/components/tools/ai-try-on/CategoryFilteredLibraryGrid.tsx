'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type {
  AiTryOnReferenceAssetDto,
  AiTryOnReferenceRole,
} from '@/hooks/api/types';

interface CategoryFilteredLibraryGridProps {
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

// 姿势分类映射
const POSE_CATEGORIES = {
  all: { label: '全部姿势', tags: [] },
  standing: { label: '站姿', tags: ['站姿', 'a-pose', 't-pose', 'standing'] },
  sitting: { label: '坐姿', tags: ['坐姿', '侧坐・女孩坐', '背向坐位'] },
  kneeling: { label: '跪姿', tags: ['跪立', '跪立・四肢着地'] },
  lying: { label: '躺卧', tags: ['趴卧', '躺卧'] },
  squatting: { label: '蹲姿', tags: ['蹲姿'] },
  sexy: { label: '性感系', tags: ['性感・大胆系', '挤胸・强调事业线系', '前倾', '后仰・挺背'] },
  cute: { label: '可爱系', tags: ['可爱系'] },
  motion: { label: '动作', tags: ['motion', 'walking', '扭身', '立位'] },
} as const;

export function CategoryFilteredLibraryGrid({
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
}: CategoryFilteredLibraryGridProps) {
  const t = useTranslations('ImageTryOn');
  const [activeCategory, setActiveCategory] = useState<keyof typeof POSE_CATEGORIES>('all');

  // 按分类筛选图片
  const filteredItems = useMemo(() => {
    if (activeCategory === 'all') return items;
    
    const categoryTags = POSE_CATEGORIES[activeCategory].tags;
    return items.filter(item => 
      item.tags.some(tag => categoryTags.includes(tag))
    );
  }, [items, activeCategory]);

  // 统计每个分类的数量
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: items.length };
    
    (Object.keys(POSE_CATEGORIES) as Array<keyof typeof POSE_CATEGORIES>).forEach(key => {
      if (key === 'all') return;
      const categoryTags = POSE_CATEGORIES[key].tags;
      counts[key] = items.filter(item =>
        item.tags.some(tag => categoryTags.includes(tag))
      ).length;
    });
    
    return counts;
  }, [items]);

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
      {/* 分类标签 */}
      {role === 'pose' && (
        <div className="flex flex-wrap gap-2">
          {(Object.keys(POSE_CATEGORIES) as Array<keyof typeof POSE_CATEGORIES>).map(key => {
            const category = POSE_CATEGORIES[key];
            const count = categoryCounts[key] || 0;
            const isActive = activeCategory === key;
            
            if (key !== 'all' && count === 0) return null;
            
            return (
              <button
                key={key}
                type="button"
                disabled={disabled}
                onClick={() => setActiveCategory(key)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-foreground text-background'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                } disabled:opacity-50`}
              >
                {category.label}
                <span className="ml-1.5 opacity-70">({count})</span>
              </button>
            );
          })}
        </div>
      )}

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
          该分类暂无姿势
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
